const dayMs=86_400_000;
const validIso=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const inclusiveDays=(from:string,to:string)=>Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/dayMs)+1;

export type GroupedFamilyPayType="paternity"|"shared-parental"|"bereavement";
export type FamilyPayClaim={
  statutoryType:GroupedFamilyPayType;
  familyEventReference:string;
  familyEventDate:string;
  startDate:string;
  endDate:string;
  previousClaimedWeeks:number;
  previousBlocks:number;
  sharedPayWeeksAvailable?:number;
};

export function assessFamilyPayClaim(input:FamilyPayClaim){
  const empty={valid:false,error:"",claimedWeeks:0,remainingWeeks:0,blockNumber:input.previousBlocks+1};
  if(!input.familyEventReference.trim()||input.familyEventReference.trim().length>80)return {...empty,error:"Enter a family-event reference of no more than 80 characters so related claims share one entitlement."};
  if(![input.familyEventDate,input.startDate,input.endDate].every(validIso))return {...empty,error:"Enter valid family-event and statutory-pay dates."};
  if(input.endDate<input.startDate)return {...empty,error:"The statutory-pay end date cannot be before its start date."};
  if(input.startDate<input.familyEventDate)return {...empty,error:"This statutory-pay block cannot start before the recorded birth, placement, death or miscarriage date."};
  const days=inclusiveDays(input.startDate,input.endDate),claimedWeeks=days/7;
  if(!Number.isInteger(claimedWeeks)||claimedWeeks<1)return {...empty,claimedWeeks,error:"This statutory-pay block must cover one or more complete weeks."};
  const elapsedDays=inclusiveDays(input.familyEventDate,input.endDate)-1;
  const rules=input.statutoryType==="shared-parental"
    ?{windowWeeks:52,maxWeeks:Math.min(37,Number(input.sharedPayWeeksAvailable)),maxBlocks:3}
    :input.statutoryType==="bereavement"?{windowWeeks:56,maxWeeks:2,maxBlocks:2}:{windowWeeks:52,maxWeeks:2,maxBlocks:2};
  if(input.statutoryType==="shared-parental"&&(!Number.isInteger(input.sharedPayWeeksAvailable)||Number(input.sharedPayWeeksAvailable)<1||Number(input.sharedPayWeeksAvailable)>37))return {...empty,claimedWeeks,error:"Record between 1 and 37 weeks of Shared Parental Pay made available by curtailing maternity or adoption pay."};
  if(elapsedDays>rules.windowWeeks*7)return {...empty,claimedWeeks,error:`This ${input.statutoryType.replace("-"," ")} pay must finish within ${rules.windowWeeks} weeks of the family event.`};
  if(input.previousBlocks>=rules.maxBlocks)return {...empty,claimedWeeks,error:`No more than ${rules.maxBlocks} statutory-pay blocks are allowed for this family event.`};
  const remainingWeeks=Math.max(0,rules.maxWeeks-input.previousClaimedWeeks);
  if(claimedWeeks>remainingWeeks)return {...empty,claimedWeeks,remainingWeeks,error:`Only ${remainingWeeks} statutory-pay week(s) remain for this family event.`};
  return {valid:true,error:"",claimedWeeks,remainingWeeks:remainingWeeks-claimedWeeks,blockNumber:input.previousBlocks+1};
}

export type MaternityAdoptionPayClaim={
  statutoryType:"maternity"|"adoption";
  familyEventReference:string;
  familyEventDate:string;
  startDate:string;
  endDate:string;
  payPeriodStart:string;
  previousClaimedDays:number;
};

export function assessMaternityAdoptionPayClaim(input:MaternityAdoptionPayClaim){
  const empty={valid:false,error:"",claimedDays:0,remainingDays:0,payPeriodDayOffset:0,payPeriodStart:input.payPeriodStart,payPeriodEnd:""};
  if(!input.familyEventReference.trim()||input.familyEventReference.trim().length>80)return {...empty,error:"Enter a maternity or adoption event reference of no more than 80 characters so related records share one pay period."};
  if(![input.familyEventDate,input.startDate,input.endDate,input.payPeriodStart].every(validIso))return {...empty,error:"Enter valid family-event and statutory-pay-period dates."};
  if(input.endDate<input.startDate)return {...empty,error:"The statutory-pay end date cannot be before its start date."};
  if(input.startDate<input.payPeriodStart)return {...empty,error:"A related statutory-pay record cannot start before the recorded maternity or adoption pay period."};
  const claimedDays=inclusiveDays(input.startDate,input.endDate),payPeriodDayOffset=inclusiveDays(input.payPeriodStart,input.startDate)-1;
  if(claimedDays<7||claimedDays%7!==0)return {...empty,claimedDays,payPeriodDayOffset,error:"Maternity and adoption statutory-pay records must cover complete weeks."};
  const payPeriodEnd=new Date(Date.parse(`${input.payPeriodStart}T00:00:00Z`)+(39*7-1)*dayMs).toISOString().slice(0,10);
  if(input.endDate>payPeriodEnd)return {...empty,claimedDays,payPeriodDayOffset,payPeriodEnd,error:`The 39-week statutory-pay period ends on ${payPeriodEnd}; excluded weeks do not extend it.`};
  const remainingDays=Math.max(0,39*7-input.previousClaimedDays);
  if(claimedDays>remainingDays)return {...empty,claimedDays,remainingDays,payPeriodDayOffset,payPeriodEnd,error:`Only ${remainingDays/7} statutory-pay week(s) remain for this family event.`};
  return {valid:true,error:"",claimedDays,remainingDays:remainingDays-claimedDays,payPeriodDayOffset,payPeriodStart:input.payPeriodStart,payPeriodEnd};
}
