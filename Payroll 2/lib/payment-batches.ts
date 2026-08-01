import { and, eq } from "drizzle-orm";
import { submissions } from "../db/schema";

const includesEmployee=(payload:string|null,employeeId:number)=>{
  try{
    const parsed=JSON.parse(payload||"{}");
    return parsed?.schemaVersion==="payflow-bank-payment-1"
      &&Array.isArray(parsed.recipients)
      &&parsed.recipients.some((recipient:unknown)=>Number((recipient as {employeeId?:unknown})?.employeeId)===employeeId);
  }catch{return false;}
};

export async function supersedeEmployeePaymentBatches(db:any,employerId:number,employeeId:number,reason:string){
  const generated=await db.select().from(submissions).where(and(
    eq(submissions.employerId,employerId),eq(submissions.type,"BANK-PAYMENT"),eq(submissions.status,"generated"),
  ));
  const affected=generated.filter((batch:typeof submissions.$inferSelect)=>includesEmployee(batch.payload,employeeId));
  const updatedAt=new Date().toISOString();
  for(const batch of affected)await db.update(submissions).set({
    status:"superseded",response:`Superseded because ${reason}. Generate a new bank payment file before authorisation.`,updatedAt,
  }).where(and(eq(submissions.id,batch.id),eq(submissions.employerId,employerId),eq(submissions.status,"generated")));
  return affected.map((batch:typeof submissions.$inferSelect)=>batch.id);
}
