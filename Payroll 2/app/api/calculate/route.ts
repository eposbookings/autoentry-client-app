import { NextResponse } from "next/server";
import { calculateMonthlyPayroll, calculateStatutoryPay, solveGrossForTargetNet, type PayrollInput } from "../../../lib/payroll-engine";
import { readJsonObject } from "../../../lib/request-body";

export async function POST(request: Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON payroll calculation object is required."},{status:400});
  if (input.kind === "statutory") {
    const averageWeeklyEarnings=Number(input.averageWeeklyEarnings),weeks=Number(input.weeks);
    const payableDays=input.payableDays===undefined?undefined:Number(input.payableDays);
    const qualifyingDaysPerWeek=input.qualifyingDaysPerWeek===undefined?undefined:Number(input.qualifyingDaysPerWeek);
    if(!Number.isFinite(averageWeeklyEarnings)||averageWeeklyEarnings<0||!Number.isFinite(weeks)||weeks<0)
      return NextResponse.json({error:"Average weekly earnings and weeks must be valid non-negative numbers."},{status:422});
    if(payableDays!==undefined&&(!Number.isInteger(payableDays)||payableDays<0))
      return NextResponse.json({error:"Payable days must be a non-negative whole number."},{status:422});
    if(qualifyingDaysPerWeek!==undefined&&(!Number.isInteger(qualifyingDaysPerWeek)||qualifyingDaysPerWeek<1||qualifyingDaysPerWeek>7))
      return NextResponse.json({error:"Qualifying days per week must be between 1 and 7."},{status:422});
    return NextResponse.json(calculateStatutoryPay(input.type,averageWeeklyEarnings,weeks,Boolean(input.smallEmployer),{payableDays,qualifyingDaysPerWeek}));
  }
  if(input.kind==="target-net"){
    const targetNetPay=Number(input.targetNetPay);
    if(!Number.isFinite(targetNetPay)||targetNetPay<0)
      return NextResponse.json({error:"Target net pay must be a valid non-negative number."},{status:422});
    try{return NextResponse.json(solveGrossForTargetNet(input as Omit<PayrollInput,"grossPay">,targetNetPay));}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Target net pay could not be calculated."},{status:422});}
  }
  const grossPay=Number(input.grossPay);
  if(!Number.isFinite(grossPay)||grossPay<0)
    return NextResponse.json({error:"Gross pay must be a valid non-negative number."},{status:422});
  return NextResponse.json(calculateMonthlyPayroll({...input,grossPay} as PayrollInput));
}
