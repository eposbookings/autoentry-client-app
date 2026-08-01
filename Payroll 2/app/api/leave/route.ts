import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employerCalendarDays, employees, employers, leaveEvents, payPeriods, payRuns } from "../../../db/schema";
import { calculateStatutoryPay } from "../../../lib/payroll-engine";
import { assessStatutoryEligibility } from "../../../lib/statutory-eligibility";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { deriveStatutoryAwe } from "../../../lib/statutory-awe";
import { assessNeonatalCareClaim } from "../../../lib/neonatal-care";
import { assessFamilyPayClaim, assessMaternityAdoptionPayClaim } from "../../../lib/family-pay";
import { assessStatutoryTouchDays, type StatutoryTouchDay } from "../../../lib/statutory-touch-days";
import { assessStatutoryWorkedWeeks, type StatutoryWorkedWeek } from "../../../lib/statutory-work-weeks";
import { countWorkingDays, defaultWorkingWeekdays, normalizeWorkingWeekdays } from "../../../lib/working-days";
import { annualLeaveUsed, leaveEntitlementBalance, leaveYearsAcrossRange } from "../../../lib/leave-entitlement";

const validIsoDate=(value:unknown)=>{
  const text=String(value||""),timestamp=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
};
const payrollPeriodOverlaps=(period:{periodStart:string|null;periodEnd:string|null},startDate:string,endDate:string)=>
  Boolean(period.periodStart&&period.periodEnd&&startDate<=period.periodEnd&&endDate>=period.periodStart);
const statutoryTypes=new Set(["none","maternity","adoption","sick","paternity","shared-parental","bereavement","neonatal"]);
const touchDayTypes=new Set(["maternity","adoption","shared-parental"]);
const parseTouchDays=(value:string|null):StatutoryTouchDay[]=>{
  if(!value)return [];
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}
};
const parseWorkedWeeks=(value:string|null):StatutoryWorkedWeek[]=>{
  if(!value)return [];
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}
};
async function payrollAwe(db:ReturnType<typeof getDb>,employerId:number,employee:{id:number;reportedPayFrequency:string;annualSalary:number},relevantDate:string){
  const periods=await db.select().from(payPeriods).where(eq(payPeriods.employerId,employerId));
  const periodById=new Map(periods.map(period=>[period.id,period])),periodIds=new Set(periods.map(period=>period.id));
  const runs=(await db.select().from(payRuns).where(and(eq(payRuns.employeeId,employee.id),eq(payRuns.status,"finalised"))))
    .filter(run=>periodIds.has(run.payPeriodId)).map(run=>({payDate:periodById.get(run.payPeriodId)?.payDate||"",earnings:run.nicablePay}));
  const frequency=periods.find(period=>period.frequency)?.frequency||employee.reportedPayFrequency||"monthly";
  const calculation=deriveStatutoryAwe(runs,relevantDate,frequency,employee.annualSalary/52);
  return {...calculation,frequency,relevantDate,paymentsUsed:runs.filter(run=>calculation.relevantPeriodStart&&run.payDate>=calculation.relevantPeriodStart&&calculation.relevantPeriodEnd&&run.payDate<=calculation.relevantPeriodEnd)};
}

export async function GET(request: Request) {
  const url=new URL(request.url),employerId = Number(url.searchParams.get("employerId") || 1);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const db = getDb();
  if(url.searchParams.get("action")==="calculate-awe"){
    const payrollId=String(url.searchParams.get("payrollId")||""),relevantDate=String(url.searchParams.get("relevantDate")||"");
    if(!validIsoDate(relevantDate))return NextResponse.json({error:"Enter the first absence or statutory relevant date."},{status:422});
    const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
    if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
    return NextResponse.json(await payrollAwe(db,employerId,employee,relevantDate));
  }
  const rows = await db.select({
    id: leaveEvents.id, employeeId: leaveEvents.employeeId, payrollId:employees.payrollId, type: leaveEvents.type,
    subtype: leaveEvents.subtype, startDate: leaveEvents.startDate, endDate: leaveEvents.endDate,
    qualifyingDays:leaveEvents.qualifyingDays,qualifyingDaysPerWeek:leaveEvents.qualifyingDaysPerWeek,
    qualifyingWeekdays:leaveEvents.qualifyingWeekdays,excludedCalendarDates:leaveEvents.excludedCalendarDates,
    averageWeeklyEarnings: leaveEvents.averageWeeklyEarnings, statutoryAmount: leaveEvents.statutoryAmount,
    averageWeeklyEarningsSource:leaveEvents.averageWeeklyEarningsSource,relevantPeriodStart:leaveEvents.relevantPeriodStart,
    relevantPeriodEnd:leaveEvents.relevantPeriodEnd,relevantPayTotal:leaveEvents.relevantPayTotal,
    recoveredAmount: leaveEvents.recoveredAmount, status: leaveEvents.status,confidential:employees.confidential,
    childBirthDate:leaveEvents.childBirthDate,neonatalCareStartDate:leaveEvents.neonatalCareStartDate,
    neonatalCareEndDate:leaveEvents.neonatalCareEndDate,neonatalTier:leaveEvents.neonatalTier,
    relationshipDeclaration:leaveEvents.relationshipDeclaration,caringResponsibilityDeclaration:leaveEvents.caringResponsibilityDeclaration,
    familyEventReference:leaveEvents.familyEventReference,familyEventDate:leaveEvents.familyEventDate,
    familyEventKind:leaveEvents.familyEventKind,sharedPayWeeksAvailable:leaveEvents.sharedPayWeeksAvailable,
    statutoryPayPeriodStart:leaveEvents.statutoryPayPeriodStart,
    statutoryTouchDays:leaveEvents.statutoryTouchDays,
    statutoryWorkedWeeks:leaveEvents.statutoryWorkedWeeks,
    statutoryPaidDayOffset:leaveEvents.statutoryPaidDayOffset,
  }).from(leaveEvents).innerJoin(employees, eq(leaveEvents.employeeId, employees.id))
    .where(eq(employees.employerId, employerId)).orderBy(desc(leaveEvents.id));
  return NextResponse.json(access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential));
}

export async function POST(request: Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON leave-event object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const payrollId = String(input.payrollId || "");
  let owner = await db.select({ id: employees.id,startDate:employees.startDate,leavingDate:employees.leavingDate,reportedPayFrequency:employees.reportedPayFrequency,annualSalary:employees.annualSalary,annualLeaveDays:employees.annualLeaveDays,workingDaysPerWeek:employees.workingDaysPerWeek,confidential:employees.confidential }).from(employees)
    .where(and(eq(employees.employerId, employerId), eq(employees.payrollId, payrollId))).limit(1);
  if (!owner.length) {
    const employer = await db.select({ id: employers.id }).from(employers).where(eq(employers.id, employerId)).limit(1);
    if (!employer.length) return NextResponse.json({ error: "Employer was not found." }, { status: 404 });
    return NextResponse.json({ error: "Save the employee before recording leave." }, { status: 404 });
  }
  if(owner[0].confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Save the employee before recording leave."},{status:404});
  if (!validIsoDate(input.startDate) || !validIsoDate(input.endDate) || String(input.endDate) < String(input.startDate)) {
    return NextResponse.json({ error: "Enter a valid leave date range." }, { status: 400 });
  }
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const dayMs=86_400_000,start=Date.parse(`${input.startDate}T00:00:00Z`),end=Date.parse(`${input.endDate}T00:00:00Z`);
  const calendarDays=Math.floor((end-start)/dayMs)+1,statutoryType=String(input.statutoryType);
  if(!statutoryTypes.has(statutoryType))return NextResponse.json({error:"Select a supported statutory payment type."},{status:422});
  const workPatternTypes=new Set(["Annual leave","Unpaid leave","Absent","On strike","Parental leave (unpaid)"]);
  const workPatternLeave=statutoryType==="none"&&workPatternTypes.has(String(input.type));
  const excludedCalendarDates=workPatternLeave?(await db.select({date:employerCalendarDays.date}).from(employerCalendarDays).where(and(
    eq(employerCalendarDays.employerId,employerId),eq(employerCalendarDays.status,"active"),
  ))).map(item=>item.date).filter(date=>date>=String(input.startDate)&&date<=String(input.endDate)):[];
  const requestedWeekdays=Array.isArray(input.qualifyingWeekdays)?input.qualifyingWeekdays:defaultWorkingWeekdays(owner[0].workingDaysPerWeek);
  const qualifyingWeekdays=normalizeWorkingWeekdays(requestedWeekdays.map(Number));
  if((statutoryType==="sick"||workPatternLeave)&&!qualifyingWeekdays.length)return NextResponse.json({error:"Select at least one scheduled working weekday."},{status:422});
  const qualifyingDaysPerWeek=statutoryType==="sick"||workPatternLeave?qualifyingWeekdays.length:7;
  const derivedQualifyingDays=statutoryType==="sick"||workPatternLeave
    ?countWorkingDays(String(input.startDate),String(input.endDate),qualifyingWeekdays,workPatternLeave?excludedCalendarDates:[])
    :calendarDays;
  const suppliedQualifyingDays=Number(input.qualifyingDays??calendarDays);
  if(!Number.isInteger(suppliedQualifyingDays)||suppliedQualifyingDays<0||suppliedQualifyingDays>calendarDays)return NextResponse.json({error:`Qualifying days must be a whole number between 0 and ${calendarDays}.`},{status:422});
  const requestedQualifyingDays=suppliedQualifyingDays;
  const payableDays=statutoryType==="sick"?Math.min(requestedQualifyingDays,derivedQualifyingDays):workPatternLeave?derivedQualifyingDays:calendarDays;
  const derivedWeeks=statutoryType==="sick"?payableDays/qualifyingDaysPerWeek:payableDays/7;
  const source=String(input.averageWeeklyEarningsSource||"manual"),relevantDate=String(input.aweRelevantDate||"");
  if(!["manual","finalised-payroll"].includes(source))return NextResponse.json({error:"Average weekly earnings source must be manual or finalised payroll."},{status:422});
  if(source==="finalised-payroll"&&!validIsoDate(relevantDate))return NextResponse.json({error:"Enter the statutory relevant date for payroll-derived average weekly earnings."},{status:422});
  const authoritativeAwe=source==="finalised-payroll"&&validIsoDate(relevantDate)?await payrollAwe(db,employerId,owner[0],relevantDate):null;
  const averageWeeklyEarnings=authoritativeAwe?.averageWeeklyEarnings??Number(input.averageWeeklyEarnings);
  if(!Number.isFinite(averageWeeklyEarnings)||averageWeeklyEarnings<0)return NextResponse.json({error:"Average weekly earnings must be a valid non-negative amount."},{status:422});
  const existingEvents=await db.select().from(leaveEvents).where(eq(leaveEvents.employeeId,owner[0].id));
  const groupedFamilyTypes=new Set(["maternity","adoption","paternity","shared-parental","bereavement"]);
  const groupedBlockTypes=new Set(["paternity","shared-parental","bereavement"]);
  const familyEventReference=String(input.familyEventReference||"").trim(),familyEventKind=String(input.familyEventKind||"");
  const allowedFamilyKinds:Record<string,string[]>={maternity:["birth"],adoption:["adoption"],paternity:["birth","adoption"],"shared-parental":["birth","adoption"],bereavement:["death","stillbirth","miscarriage"]};
  if(groupedFamilyTypes.has(statutoryType)&&!allowedFamilyKinds[statutoryType].includes(familyEventKind))return NextResponse.json({error:"Select a supported family-event type for this statutory payment."},{status:422});
  const activeFamilyClaims=groupedFamilyTypes.has(statutoryType)?existingEvents.filter(event=>event.status!=="cancelled"&&event.subtype===statutoryType):[];
  if(activeFamilyClaims.some(event=>event.familyEventReference===familyEventReference&&(event.familyEventDate!==String(input.familyEventDate)||event.familyEventKind!==familyEventKind)))return NextResponse.json({error:"This family-event reference is already attached to different event details."},{status:409});
  const relatedFamilyClaims=activeFamilyClaims.filter(event=>event.familyEventDate===String(input.familyEventDate)&&event.familyEventKind===familyEventKind);
  if(relatedFamilyClaims.some(event=>event.familyEventReference!==familyEventReference))return NextResponse.json({error:`Reuse family-event reference ${relatedFamilyClaims[0].familyEventReference} for this event so its remaining entitlement is preserved.`},{status:409});
  if(statutoryType==="shared-parental"&&relatedFamilyClaims.some(event=>event.sharedPayWeeksAvailable!==Number(input.sharedPayWeeksAvailable)))return NextResponse.json({error:"The Shared Parental Pay availability must match the first block for this family event."},{status:409});
  if(input.statutoryTouchDays!==undefined&&!Array.isArray(input.statutoryTouchDays))return NextResponse.json({error:"Work-in-touch days must be supplied as an array."},{status:422});
  const statutoryTouchDays=(Array.isArray(input.statutoryTouchDays)?input.statutoryTouchDays:[]).map((day:any)=>({date:String(day?.date||""),kind:String(day?.kind||"") as "kit"|"split"}));
  if(!touchDayTypes.has(statutoryType)&&statutoryTouchDays.length)return NextResponse.json({error:"KIT and SPLIT days apply only to maternity, adoption or shared parental pay."},{status:422});
  const touchDayAssessment=touchDayTypes.has(statutoryType)?assessStatutoryTouchDays({
    statutoryType:statutoryType as "maternity"|"adoption"|"shared-parental",startDate:String(input.startDate),endDate:String(input.endDate),
    days:statutoryTouchDays,previousDays:relatedFamilyClaims.flatMap(event=>parseTouchDays(event.statutoryTouchDays)),
  }):null;
  if(touchDayAssessment&&!touchDayAssessment.valid)return NextResponse.json({error:touchDayAssessment.error,touchDayAssessment},{status:422});
  const familyClaim=groupedBlockTypes.has(statutoryType)?assessFamilyPayClaim({
    statutoryType:statutoryType as "paternity"|"shared-parental"|"bereavement",familyEventReference,
    familyEventDate:String(input.familyEventDate||""),startDate:String(input.startDate),endDate:String(input.endDate),
    previousClaimedWeeks:relatedFamilyClaims.reduce((sum,event)=>sum+event.qualifyingDays/7,0),
    previousBlocks:relatedFamilyClaims.length,sharedPayWeeksAvailable:Number(input.sharedPayWeeksAvailable),
  }):null;
  if(familyClaim&&!familyClaim.valid)return NextResponse.json({error:familyClaim.error,familyClaim},{status:422});
  const maternityAdoptionClaim=["maternity","adoption"].includes(statutoryType)?assessMaternityAdoptionPayClaim({
    statutoryType:statutoryType as "maternity"|"adoption",familyEventReference,familyEventDate:String(input.familyEventDate||""),
    startDate:String(input.startDate),endDate:String(input.endDate),
    payPeriodStart:[String(input.startDate),...relatedFamilyClaims.map(event=>event.statutoryPayPeriodStart||event.startDate)].sort()[0],
    previousClaimedDays:relatedFamilyClaims.reduce((sum,event)=>sum+event.qualifyingDays,0),
  }):null;
  if(maternityAdoptionClaim&&!maternityAdoptionClaim.valid)return NextResponse.json({error:maternityAdoptionClaim.error,maternityAdoptionClaim},{status:422});
  if(input.ordinaryWorkDates!==undefined&&!Array.isArray(input.ordinaryWorkDates))return NextResponse.json({error:"Ordinary work dates must be supplied as an array."},{status:422});
  const ordinaryWorkDates=(Array.isArray(input.ordinaryWorkDates)?input.ordinaryWorkDates:[]).map(value=>String(value||""));
  const payPeriodStart=maternityAdoptionClaim?.payPeriodStart||String(input.startDate);
  const previousWorkedWeeks=relatedFamilyClaims.flatMap(event=>parseWorkedWeeks(event.statutoryWorkedWeeks));
  const workedWeekAssessment=assessStatutoryWorkedWeeks({
    statutoryType,startDate:String(input.startDate),endDate:String(input.endDate),payPeriodStart,
    workDates:ordinaryWorkDates,protectedDates:statutoryTouchDays.map(day=>day.date),previousWeeks:previousWorkedWeeks,
  });
  if(!workedWeekAssessment.valid)return NextResponse.json({error:workedWeekAssessment.error,workedWeekAssessment},{status:422});
  const priorExcludedWeeks=relatedFamilyClaims
    .filter(event=>event.endDate<String(input.startDate))
    .reduce((sum,event)=>sum+parseWorkedWeeks(event.statutoryWorkedWeeks).length,0);
  const result = calculateStatutoryPay(statutoryType, averageWeeklyEarnings, derivedWeeks, employer.smallEmployersRelief,{
    payableDays,qualifyingDaysPerWeek,payPeriodDayOffset:maternityAdoptionClaim?.payPeriodDayOffset,
    excludedWeekOffsets:workedWeekAssessment.excludedWeekOffsets,priorExcludedWeeks,
  });
  const storedPayableDays=statutoryType==="none"?payableDays:"payableDays" in result?result.payableDays:calendarDays;
  const assessment=statutoryType==="none"?null:assessStatutoryEligibility({
    statutoryType,averageWeeklyEarnings,
    continuousEmploymentWeeks:Number(input.continuousEmploymentWeeks??26),
    evidenceReceived:Boolean(input.evidenceReceived??true),noticeReceived:Boolean(input.noticeReceived??true),
    inLegalCustody:Boolean(input.inLegalCustody),sspEnding:Boolean(input.sspEnding),
  });
  const draft=input.status==="draft";
  const annualLeaveBalances=String(input.type)==="Annual leave"?leaveYearsAcrossRange(String(input.startDate),String(input.endDate)).map(leaveYear=>{
    const current=leaveEntitlementBalance(owner[0].annualLeaveDays,owner[0].startDate,owner[0].leavingDate,existingEvents,leaveYear);
    const requested=annualLeaveUsed([{type:"Annual leave",startDate:String(input.startDate),endDate:String(input.endDate),qualifyingDays:payableDays,qualifyingWeekdays:qualifyingWeekdays.join(","),excludedCalendarDates:JSON.stringify(excludedCalendarDates),status:"calculated"}],leaveYear);
    return {leaveYear,...current,requested,projectedRemaining:Math.round((current.remaining-requested)*100)/100};
  }):[];
  const exceeded=annualLeaveBalances.find(balance=>balance.projectedRemaining<0);
  if(!draft&&exceeded)return NextResponse.json({
    error:`This annual-leave booking exceeds the ${exceeded.leaveYear} entitlement by ${Math.abs(exceeded.projectedRemaining).toFixed(2)} day(s). Save it as a draft or reduce the dates.`,
    leaveBalance:exceeded,
  },{status:409});
  const neonatalClaim=statutoryType==="neonatal"?assessNeonatalCareClaim({
    childBirthDate:String(input.childBirthDate||""),careStartDate:String(input.neonatalCareStartDate||""),
    careEndDate:String(input.neonatalCareEndDate||""),payStartDate:String(input.startDate),payEndDate:String(input.endDate),
    tier:String(input.neonatalTier||"") as "tier-1"|"tier-2",
    relationshipDeclaration:Boolean(input.relationshipDeclaration),caringResponsibilityDeclaration:Boolean(input.caringResponsibilityDeclaration),
  }):null;
  if(neonatalClaim&&!neonatalClaim.valid)return NextResponse.json({error:neonatalClaim.error,neonatalClaim},{status:422});
  if(!draft&&statutoryType!=="none"&&authoritativeAwe?.paymentCount===0)return NextResponse.json({
    error:"No finalised payment exists before the statutory relevant date. Save a draft and review documented new-starter earnings before calculating statutory pay.",
    awe:authoritativeAwe,
  },{status:422});
  if (!draft&&(!result.eligible||assessment&&!assessment.eligible) && payableDays > 0 && statutoryType !== "none") {
    return NextResponse.json({ error: assessment&&!assessment.eligible?assessment.reason:result.reason, calculation: result, assessment }, { status: 422 });
  }
  if(!draft){
    if(["sick","none"].includes(statutoryType)&&((owner[0].startDate&&String(input.startDate)<owner[0].startDate)||(owner[0].leavingDate&&String(input.endDate)>owner[0].leavingDate))){
      return NextResponse.json({error:statutoryType==="sick"?"SSP dates must fall entirely within the employee’s recorded employment dates.":"Annual and unpaid leave dates must fall entirely within the employee’s recorded employment dates."},{status:422});
    }
    const finalisedPeriods=await db.select({periodStart:payPeriods.periodStart,periodEnd:payPeriods.periodEnd}).from(payPeriods)
      .where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.status,"finalised")));
    const locked=finalisedPeriods.some(period=>payrollPeriodOverlaps(period,String(input.startDate),String(input.endDate)));
    if(locked)return NextResponse.json({error:"This leave overlaps a finalised payroll period. Reopen the latest affected period or record a payroll correction before calculating statutory pay."},{status:409});
  }
  if(neonatalClaim){
    const priorClaims=existingEvents.filter(event=>event.status!=="cancelled"&&event.subtype==="neonatal"&&event.childBirthDate===String(input.childBirthDate));
    if(input.neonatalTier==="tier-2"&&priorClaims.some(event=>event.neonatalTier==="tier-2"))return NextResponse.json({error:"Tier 2 Neonatal Care Pay must be taken as one continuous block. Cancel and replace the existing Tier 2 claim if its dates are wrong."},{status:409});
    const previouslyClaimedWeeks=priorClaims.reduce((sum,event)=>sum+event.qualifyingDays/7,0);
    if(previouslyClaimedWeeks+neonatalClaim.claimedWeeks>neonatalClaim.accruedWeeks)return NextResponse.json({error:`The recorded care supports ${neonatalClaim.accruedWeeks} week(s); ${previouslyClaimedWeeks} week(s) have already been claimed.`,neonatalClaim},{status:422});
  }
  const duplicate=existingEvents.some(event=>event.status!=="cancelled"&&event.type===String(input.type)&&event.startDate<=String(input.endDate)&&event.endDate>=String(input.startDate));
  if(duplicate) return NextResponse.json({error:"An overlapping leave event of this type already exists for the employee."},{status:409});
  const statutoryOverlap=!draft&&statutoryType!=="none"&&existingEvents.some(event=>
    event.status==="calculated"&&Number(event.statutoryAmount)>0&&
    event.startDate<=String(input.endDate)&&event.endDate>=String(input.startDate)
  );
  if(statutoryOverlap)return NextResponse.json({error:"A calculated statutory payment already overlaps this date range. Cancel or correct the existing event before adding another statutory payment."},{status:409});
  const notes=String(input.notes||"").trim()||null;
  if(notes&&notes.length>1000)return NextResponse.json({error:"Leave notes cannot exceed 1,000 characters."},{status:422});
  const [created] = await db.insert(leaveEvents).values({
    employeeId: owner[0].id, type: String(input.type), subtype: input.subtype || input.statutoryType || null,
    startDate: String(input.startDate), endDate: String(input.endDate),
    qualifyingDays: storedPayableDays,
    qualifyingDaysPerWeek:statutoryType==="sick"||workPatternLeave?qualifyingDaysPerWeek:7,
    qualifyingWeekdays:statutoryType==="sick"||workPatternLeave?qualifyingWeekdays.join(","):"1,2,3,4,5,6,7",
    excludedCalendarDates:workPatternLeave?JSON.stringify(excludedCalendarDates):"[]",
    averageWeeklyEarnings,
    averageWeeklyEarningsSource:authoritativeAwe?"finalised-payroll":"manual",
    relevantPeriodStart:authoritativeAwe?.relevantPeriodStart||null,relevantPeriodEnd:authoritativeAwe?.relevantPeriodEnd||null,
    relevantPayTotal:authoritativeAwe?.relevantPayTotal||0,
    statutoryAmount: result.total, recoveredAmount: result.recoverable,
    childBirthDate:statutoryType==="neonatal"?String(input.childBirthDate):null,
    neonatalCareStartDate:statutoryType==="neonatal"?String(input.neonatalCareStartDate):null,
    neonatalCareEndDate:statutoryType==="neonatal"?String(input.neonatalCareEndDate):null,
    neonatalTier:statutoryType==="neonatal"?String(input.neonatalTier):null,
    relationshipDeclaration:statutoryType==="neonatal"&&Boolean(input.relationshipDeclaration),
    caringResponsibilityDeclaration:statutoryType==="neonatal"&&Boolean(input.caringResponsibilityDeclaration),
    familyEventReference:groupedFamilyTypes.has(statutoryType)?familyEventReference:null,
    familyEventDate:groupedFamilyTypes.has(statutoryType)?String(input.familyEventDate):null,
    familyEventKind:groupedFamilyTypes.has(statutoryType)?familyEventKind:null,
    sharedPayWeeksAvailable:statutoryType==="shared-parental"?Number(input.sharedPayWeeksAvailable):null,
    statutoryPayPeriodStart:maternityAdoptionClaim?.payPeriodStart||null,
    statutoryTouchDays:touchDayAssessment&&statutoryTouchDays.length?JSON.stringify(statutoryTouchDays):null,
    statutoryWorkedWeeks:workedWeekAssessment.weeks.length?JSON.stringify(workedWeekAssessment.weeks):null,
    statutoryPaidDayOffset:Math.max(0,(maternityAdoptionClaim?.payPeriodDayOffset||0)-priorExcludedWeeks*7),
    notes, status: draft ? "draft" : "calculated",
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`created:leave-${created.status}`,entityType:"leave-event",entityId:String(created.id),after:JSON.stringify({...created,assessment})});
  return NextResponse.json({ ...created, calculation: result, assessment, neonatalClaim, familyClaim, maternityAdoptionClaim, touchDayAssessment,workedWeekAssessment,annualLeaveBalances }, { status: 201 });
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON leave-event update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  if(input.action!=="cancel")return NextResponse.json({error:"Only guarded leave cancellation is supported; cancel and replace an incorrect event."},{status:422});
  const [event]=await db.select({
    id:leaveEvents.id,employeeId:leaveEvents.employeeId,status:leaveEvents.status,startDate:leaveEvents.startDate,endDate:leaveEvents.endDate,confidential:employees.confidential,
  }).from(leaveEvents).innerJoin(employees,eq(leaveEvents.employeeId,employees.id))
    .where(and(eq(leaveEvents.id,id),eq(employees.employerId,employerId))).limit(1);
  if(!event)return NextResponse.json({error:"Leave event was not found for this employer."},{status:404});
  if(event.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Leave event was not found for this employer."},{status:404});
  if(event.status==="cancelled")return NextResponse.json({error:"Leave event is already cancelled."},{status:409});
  const finalised=await db.select({periodStart:payPeriods.periodStart,periodEnd:payPeriods.periodEnd}).from(payPeriods)
    .where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.status,"finalised")));
  const locked=event.status==="calculated"&&finalised.some(period=>payrollPeriodOverlaps(period,event.startDate,event.endDate));
  if(locked)return NextResponse.json({error:"This leave affected a finalised payroll period and remains as source evidence. If no FPS was accepted, reopen the latest affected period before cancellation. If HMRC accepted the FPS, retain this event, post signed finalised-pay corrections for the affected values and prepare an Additional FPS."},{status:409});
  const now=new Date().toISOString(),reason=String(input.reason||"").trim();
  if(reason.length<5)return NextResponse.json({error:"Enter a cancellation reason of at least 5 characters."},{status:422});
  const [updated]=await db.update(leaveEvents).set({status:"cancelled",notes:`${reason}${input.notes?` · ${String(input.notes)}`:""}`,updatedAt:now}).where(eq(leaveEvents.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"cancelled:leave-event",entityType:"leave-event",entityId:String(id),before:JSON.stringify(event),after:JSON.stringify({status:"cancelled",reason})});
  return NextResponse.json(updated);
}
