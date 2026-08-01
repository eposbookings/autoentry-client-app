import { childcareVoucherBandFromName, childcareVoucherLimit, type ChildcareVoucherFrequency } from "./childcare-vouchers.ts";

export const payDetailsImportTypes=[
  "period-pay","monthly-salary","additional-hours","earning","pre-tax-deduction","post-tax-deduction",
  "salary-sacrifice","payroll-giving","childcare-voucher",
] as const;

export type PayDetailsImportType=typeof payDetailsImportTypes[number];
export type PreparedPayDetail={
  rowNumber:number;
  period:number;
  payrollId:string;
  type:PayDetailsImportType;
  description:string;
  quantity:number;
  rate:number;
  amount:number;
  taxable:boolean;
  nicable:boolean;
  pensionable:boolean;
};

const clean=(value:unknown)=>String(value??"").trim();
const booleanValue=(value:unknown)=>{
  const text=clean(value).toLowerCase();
  if(["true","yes","1"].includes(text))return true;
  if(["false","no","0"].includes(text))return false;
  return null;
};
const boundedNumber=(value:unknown,max:number)=>{
  const text=clean(value);
  if(text==="")return null;
  const number=Number(text);
  return Number.isFinite(number)&&number>=0&&number<=max?number:null;
};

export function validatePayDetailsImportRows(rows:unknown,currentPeriod:number,knownPayrollIds:string[],maximumPeriods=12,payFrequency:ChildcareVoucherFrequency="monthly"){
  if(!Number.isInteger(currentPeriod)||currentPeriod<1||currentPeriod>maximumPeriods)
    return {prepared:[] as PreparedPayDetail[],errors:["Select an open payroll period before importing pay details."]};
  if(!Array.isArray(rows))return {prepared:[] as PreparedPayDetail[],errors:["Pay-detail rows must be supplied as an array."]};
  if(rows.length<1)return {prepared:[] as PreparedPayDetail[],errors:["Pay-detail import must contain at least one row."]};
  if(rows.length>2000)return {prepared:[] as PreparedPayDetail[],errors:["Pay-detail import is limited to 2,000 rows per file."]};
  const known=new Map(knownPayrollIds.map(id=>[id.trim().toLowerCase(),id.trim()]));
  const errors:string[]=[],prepared:PreparedPayDetail[]=[],singletons=new Map<string,number>(),counts=new Map<string,number>();
  rows.forEach((unknownRow,index)=>{
    const rowNumber=index+2,prefix=`Row ${rowNumber}:`;
    if(!unknownRow||typeof unknownRow!=="object"||Array.isArray(unknownRow)){
      errors.push(`${prefix} pay detail must be an object.`);
      return;
    }
    const row=unknownRow as Record<string,unknown>,period=Number(clean(row.period));
    const suppliedPayrollId=clean(row.payrollId),payrollId=known.get(suppliedPayrollId.toLowerCase())||suppliedPayrollId;
    const type=clean(row.type).toLowerCase().replace(/[_\s]+/g,"-") as PayDetailsImportType;
    const description=clean(row.description).replace(/\s+/g," ");
    const quantity=boundedNumber(row.quantity,1_000_000),rate=boundedNumber(row.rate,1_000_000),suppliedAmount=boundedNumber(row.amount,10_000_000);
    const taxable=booleanValue(row.taxable),nicable=booleanValue(row.nicable),pensionable=booleanValue(row.pensionable);
    if(!Number.isInteger(period)||period<1||period>maximumPeriods)errors.push(`${prefix} period must be a whole number between 1 and ${maximumPeriods}.`);
    else if(period!==currentPeriod)errors.push(`${prefix} period ${period} does not match the open payroll period ${currentPeriod}.`);
    if(!known.has(suppliedPayrollId.toLowerCase()))errors.push(`${prefix} payroll ID ${suppliedPayrollId||"(blank)"} was not found for this employer.`);
    if(!payDetailsImportTypes.includes(type))errors.push(`${prefix} pay type is not supported.`);
    const singleton=["period-pay","monthly-salary","additional-hours"].includes(type);
    const singletonKey=`${payrollId.toLowerCase()}:${["period-pay","monthly-salary"].includes(type)?"period-pay":type}`;
    if(singleton){
      const earlier=singletons.get(singletonKey);
      if(earlier)errors.push(`${prefix} ${type} duplicates row ${earlier} for ${payrollId}.`);
      else singletons.set(singletonKey,rowNumber);
    }
    if(["period-pay","monthly-salary"].includes(type)&&suppliedAmount===null)errors.push(`${prefix} period pay requires a non-negative amount.`);
    if(type==="additional-hours"&&(quantity===null||rate===null))errors.push(`${prefix} additional hours requires non-negative quantity and rate values.`);
    if(!singleton){
      if(description.length<1||description.length>100)errors.push(`${prefix} description must contain 1 to 100 characters.`);
      if(suppliedAmount===null&&(quantity===null||rate===null))errors.push(`${prefix} enter an amount or both quantity and rate.`);
      if(taxable===null||nicable===null||pensionable===null)
        errors.push(`${prefix} taxable, nicable and pensionable must each be true or false.`);
    }
    for(const [label,value,limit] of [["quantity",row.quantity,1_000_000],["rate",row.rate,1_000_000],["amount",row.amount,10_000_000]] as const)
      if(clean(value)!==""&&boundedNumber(value,limit)===null)errors.push(`${prefix} ${label} must be a valid non-negative value no greater than ${limit.toLocaleString("en-GB")}.`);
    const nextCount=(counts.get(payrollId.toLowerCase())||0)+(singleton?0:1);counts.set(payrollId.toLowerCase(),nextCount);
    if(nextCount>100)errors.push(`${prefix} ${payrollId} cannot contain more than 100 imported variable pay lines.`);
    if(!payDetailsImportTypes.includes(type)||!known.has(suppliedPayrollId.toLowerCase()))return;
    const effectiveQuantity=quantity??(suppliedAmount===null?0:1),effectiveRate=rate??(suppliedAmount??0);
    const effectiveAmount=suppliedAmount??Math.round((effectiveQuantity*effectiveRate+Number.EPSILON)*100)/100;
    if(type==="childcare-voucher"){
      const taxBand=childcareVoucherBandFromName(description);
      if(!taxBand)errors.push(`${prefix} childcare-voucher description must be "Legacy childcare voucher salary sacrifice · basic", "· higher" or "· additional".`);
      else if(effectiveAmount>childcareVoucherLimit(taxBand,payFrequency))
        errors.push(`${prefix} childcare-voucher amount exceeds the ${payFrequency.replace("-"," ")} ${taxBand}-rate exemption. Use the guided payroll workflow so the Class 1 excess is created.`);
      if(taxable!==false||nicable!==false)
        errors.push(`${prefix} childcare-voucher salary sacrifice must be non-taxable and non-NICable.`);
    }
    prepared.push({
      rowNumber,period,payrollId,type,
      description:description||(["period-pay","monthly-salary"].includes(type)?"Period pay":"Additional hours"),
      quantity:effectiveQuantity,rate:effectiveRate,
      amount:effectiveAmount,
      taxable:singleton?true:Boolean(taxable),nicable:singleton?true:Boolean(nicable),pensionable:singleton?true:Boolean(pensionable),
    });
  });
  return {prepared,errors};
}
