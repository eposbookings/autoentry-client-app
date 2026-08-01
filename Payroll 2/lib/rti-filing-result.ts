export function validateRtiFilingResult(input:{
  currentStatus:string;outcome:string;submittedAt:string;acknowledgementReference:string;
  responseCode?:string;responseMessage?:string;now?:number;
}){
  const errors:string[]=[];
  if(!["test-ready","submitted"].includes(input.currentStatus))errors.push("Only a test-ready or submitted RTI package can receive an external filing result.");
  if(!["accepted","rejected"].includes(input.outcome))errors.push("The HMRC result must be accepted or rejected.");
  const submittedTime=Date.parse(input.submittedAt),now=input.now??Date.now();
  if(!input.submittedAt||!Number.isFinite(submittedTime))errors.push("Enter the external submission date and time.");
  else if(submittedTime>now+300_000)errors.push("The external submission time cannot be in the future.");
  const reference=input.acknowledgementReference.trim();
  if(reference.length<6||reference.length>150)errors.push("Enter the HMRC acknowledgement or correlation reference (6 to 150 characters).");
  if(input.responseCode&&input.responseCode.trim().length>50)errors.push("The HMRC response code must not exceed 50 characters.");
  if(input.outcome==="rejected"&&(input.responseMessage||"").trim().length<3)errors.push("Record the HMRC rejection message.");
  if((input.responseMessage||"").trim().length>1000)errors.push("The HMRC response message must not exceed 1,000 characters.");
  return {valid:errors.length===0,errors,outcome:input.outcome,submittedAt:input.submittedAt,acknowledgementReference:reference};
}
