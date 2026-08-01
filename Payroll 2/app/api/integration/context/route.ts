import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLog, employerSettings, employers, eposClientMappings } from "../../../../db/schema";
import { trustedEposContext } from "../../../../lib/epos-integration";
import { readJsonObject } from "../../../../lib/request-body";

const clean=(value:unknown)=>String(value??"").trim();

export async function POST(request:Request){
  const context=await trustedEposContext(request);
  if(!context)return NextResponse.json({error:"A valid EPOS integration signature is required."},{status:401});
  const input=await readJsonObject(request);
  if(!input)return NextResponse.json({error:"A JSON client context is required."},{status:400});
  if(clean(input.clientId)!==context.clientId||clean(input.practiceId)!==context.practiceId)
    return NextResponse.json({error:"The signed EPOS tenant does not match the requested client."},{status:403});

  const db=getDb();
  const [mapping]=await db.select().from(eposClientMappings).where(eq(eposClientMappings.clientId,context.clientId)).limit(1);
  if(mapping){
    if(mapping.practiceId!==context.practiceId)return NextResponse.json({error:"This payroll client belongs to another EPOS practice."},{status:403});
    const [employer]=await db.select().from(employers).where(eq(employers.id,mapping.employerId)).limit(1);
    const [settings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,mapping.employerId)).limit(1);
    if(!employer)return NextResponse.json({error:"The mapped payroll employer is missing."},{status:409});
    return NextResponse.json({employerId:employer.id,employerName:employer.name,taxYear:employer.taxYear,payFrequency:employer.payFrequency,firstPayDate:settings?.firstPayDate||null});
  }

  const clientName=clean(input.clientName)||"EPOS payroll client";
  const taxYear=clean(input.taxYear)||"2026/27";
  const payFrequency=clean(input.payFrequency)||"monthly";
  const [employer]=await db.insert(employers).values({
    name:clientName,legalName:clientName,taxYear,payFrequency,status:"active",
  }).returning();
  try{
    await db.batch([
      db.insert(employerSettings).values({
        employerId:employer.id,firstPayDate:clean(input.firstPayDate)||null,clientStatus:"onboarding",
        typicalPayBasis:"period",typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,
        minimumHourlyRate:12.71,autoWorksNumber:true,nextWorksNumber:1,
        colourReference:"#087b79",documentPasswordStrategy:"employee-postcode",
      }),
      db.insert(eposClientMappings).values({clientId:context.clientId,practiceId:context.practiceId,employerId:employer.id}),
      db.insert(auditLog).values({
        employerId:employer.id,actor:context.email,action:"created:epos-client-link",entityType:"epos-client",entityId:context.clientId,
        after:JSON.stringify({clientId:context.clientId,practiceId:context.practiceId,clientName}),
      }),
    ]);
  }catch(error){
    await db.delete(employers).where(eq(employers.id,employer.id));
    throw error;
  }
  return NextResponse.json({employerId:employer.id,employerName:employer.name,taxYear:employer.taxYear,payFrequency:employer.payFrequency,firstPayDate:clean(input.firstPayDate)||null},{status:201});
}
