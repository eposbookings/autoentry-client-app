const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
// DWP DEA guidance requires an exact half-penny to be rounded down.
const roundHalfPennyDown=(value:number)=>Math.floor(value*100+.5-1e-9)/100;

export type AttachmentCalculation={
  deduction:number;
  adminFee:number;
  totalFromPay:number;
  balanceAfter:number|null;
  protectedEarnings:number;
  rate:number|null;
  shortfall:number;
  arrearsAfter:number;
  ordinaryDeduction:number;
  maintenanceDeduction:number;
  ordinaryBalanceAfter:number|null;
};

export type AttachmentRule="manual"|"aeo-priority"|"aeo-non-priority"|"dea-standard"|"dea-higher"|"dea-fixed"|"child-maintenance"|"council-tax-england-wales"|"scottish-earnings-arrestment"|"scottish-current-maintenance"|"scottish-conjoined-maintenance"|"scottish-conjoined-mixed"|"ni-court-fine"|"ni-ejo";
export type AttachmentFrequency="daily"|"weekly"|"fortnightly"|"four-weekly"|"monthly";

const deaBands:Record<"daily"|"weekly"|"monthly",{limit:number;standard:number;higher:number}[]>={
  daily:[{limit:15,standard:0,higher:5},{limit:23,standard:3,higher:6},{limit:32,standard:5,higher:10},{limit:39,standard:7,higher:14},{limit:54,standard:11,higher:22},{limit:75,standard:15,higher:30},{limit:Infinity,standard:20,higher:40}],
  weekly:[{limit:100,standard:0,higher:5},{limit:160,standard:3,higher:6},{limit:220,standard:5,higher:10},{limit:270,standard:7,higher:14},{limit:375,standard:11,higher:22},{limit:520,standard:15,higher:30},{limit:Infinity,standard:20,higher:40}],
  monthly:[{limit:430,standard:0,higher:5},{limit:690,standard:3,higher:6},{limit:950,standard:5,higher:10},{limit:1160,standard:7,higher:14},{limit:1615,standard:11,higher:22},{limit:2240,standard:15,higher:30},{limit:Infinity,standard:20,higher:40}],
};
const councilTaxBands:Record<"daily"|"weekly"|"monthly",{limit:number;rate:number}[]>={
  daily:[{limit:11,rate:0},{limit:20,rate:3},{limit:27,rate:5},{limit:33,rate:7},{limit:52,rate:12},{limit:72,rate:17},{limit:Infinity,rate:50}],
  weekly:[{limit:75,rate:0},{limit:135,rate:3},{limit:185,rate:5},{limit:225,rate:7},{limit:355,rate:12},{limit:505,rate:17},{limit:Infinity,rate:50}],
  monthly:[{limit:300,rate:0},{limit:550,rate:3},{limit:740,rate:5},{limit:900,rate:7},{limit:1420,rate:12},{limit:2020,rate:17},{limit:Infinity,rate:50}],
};
function bandFrequency(frequency:AttachmentFrequency):"daily"|"weekly"|"monthly"{
  return frequency==="fortnightly"||frequency==="four-weekly"?"weekly":frequency;
}
function frequencyMultiplier(frequency:AttachmentFrequency){
  return frequency==="fortnightly"?2:frequency==="four-weekly"?4:1;
}
function councilTaxDeduction(net:number,frequency:AttachmentFrequency){
  const multiplier=frequencyMultiplier(frequency),normalizedNet=net/multiplier,tableFrequency=bandFrequency(frequency);
  const bands=councilTaxBands[tableFrequency],band=bands.find(item=>normalizedNet<=item.limit)??bands.at(-1)!;
  if(band.rate!==50)return {rate:band.rate,amount:normalizedNet*band.rate/100*multiplier};
  const threshold=tableFrequency==="daily"?72:tableFrequency==="weekly"?505:2020;
  return {rate:50,amount:(threshold*.17+(normalizedNet-threshold)*.5)*multiplier};
}
function scottishEarningsArrestment(net:number,frequency:AttachmentFrequency){
  const multiplier=frequencyMultiplier(frequency);
  const normalizedNet=net/multiplier;
  let deduction:number;
  if(frequency==="monthly"){
    if(normalizedNet<=750)deduction=0;
    else if(normalizedNet<=1500)deduction=Math.max(10,(normalizedNet-750)*.15);
    else if(normalizedNet<=2500)deduction=112.5+(normalizedNet-1500)*.2;
    else if(normalizedNet<=3750)deduction=312.5+(normalizedNet-2500)*.25;
    else deduction=625+(normalizedNet-3750)*.5;
  }else if(frequency==="daily"){
    if(normalizedNet<=24.66)deduction=0;
    else if(normalizedNet<=49.32)deduction=Math.max(.33,(normalizedNet-24.66)*.15);
    else if(normalizedNet<=82.19)deduction=3.7+(normalizedNet-49.32)*.2;
    else if(normalizedNet<=123.29)deduction=10.27+(normalizedNet-82.19)*.25;
    else deduction=20.55+(normalizedNet-123.29)*.5;
  }else{
    if(normalizedNet<=172.61)deduction=0;
    else if(normalizedNet<=345.22)deduction=Math.max(2.3,(normalizedNet-172.61)*.15);
    else if(normalizedNet<=575.37)deduction=25.89+(normalizedNet-345.22)*.2;
    else if(normalizedNet<=863.06)deduction=71.92+(normalizedNet-575.37)*.25;
    else deduction=143.84+(normalizedNet-863.06)*.5;
  }
  // Section 49 applies the table to a notional week/day first, then multiplies
  // that rounded statutory deduction by the number of whole periods.
  return roundHalfPennyDown(deduction)*multiplier;
}

export function calculateAttachment(input:{
  netPay:number;
  type:string;
  deductionType:"fixed"|"percentage";
  deductionValue:number;
  calculationRule?:AttachmentRule;
  payFrequency?:AttachmentFrequency;
  protectedEarnings?:number;
  balance?:number|null;
  adminFee?:number;
  existingDeductions?:number;
  arrears?:number;
  periodDays?:number;
  ordinaryDebtBalance?:number|null;
  maintenanceDailyRate?:number;
}):AttachmentCalculation {
  const net=Math.max(0,input.netPay);
  const rule=input.calculationRule||(
    /direct earnings|\bdea\b/i.test(input.type)?"dea-fixed":
    /child maintenance|\bdeo\b/i.test(input.type)?"child-maintenance":
    /council tax/i.test(input.type)?"council-tax-england-wales":"manual"
  );
  const frequency=input.payFrequency||"monthly",prior=Math.max(0,input.existingDeductions||0),remainingNet=Math.max(0,net-prior);
  const scottishMaintenance=["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(rule);
  const periodDays=scottishMaintenance?Math.max(1,Math.round(input.periodDays||0)):0;
  if(scottishMaintenance&&(!Number.isFinite(input.periodDays)||periodDays>366))throw new Error("Scottish maintenance arrestment requires the number of days since the previous payday.");
  const sixtyPercent=["dea-standard","dea-higher","dea-fixed","child-maintenance","ni-court-fine"].includes(rule)?net*.6:0;
  const statutoryScottishProtection=scottishMaintenance?24.66*periodDays:0;
  const protectedEarnings=Math.max(0,input.protectedEarnings||0,sixtyPercent,statutoryScottishProtection);
  const available=Math.max(0,remainingNet-protectedEarnings);
  let requested=0,rate:number|null=null,ordinaryRequested=0,maintenanceRequested=0;
  if(rule==="dea-standard"||rule==="dea-higher"||rule==="ni-court-fine"){
    const multiplier=frequencyMultiplier(frequency),normalizedNet=net/multiplier,tableFrequency=bandFrequency(frequency);
    const band=deaBands[tableFrequency].find(item=>normalizedNet<=item.limit)??deaBands[tableFrequency].at(-1)!;
    rate=rule==="dea-higher"?band.higher:band.standard;requested=roundHalfPennyDown(normalizedNet*rate/100)*multiplier;
  } else if(rule==="scottish-earnings-arrestment"){
    requested=roundHalfPennyDown(scottishEarningsArrestment(remainingNet,frequency));
  } else if(rule==="scottish-conjoined-mixed"){
    const ordinaryBalance=input.ordinaryDebtBalance==null?0:Math.max(0,input.ordinaryDebtBalance);
    ordinaryRequested=Math.min(roundHalfPennyDown(scottishEarningsArrestment(remainingNet,frequency)),ordinaryBalance);
    maintenanceRequested=roundHalfPennyDown(Math.max(0,input.maintenanceDailyRate||0)*periodDays);
    requested=round(ordinaryRequested+maintenanceRequested);
  } else if(scottishMaintenance){
    requested=roundHalfPennyDown(Math.max(0,input.deductionValue)*periodDays);
  } else if(rule==="council-tax-england-wales"){
    const council=councilTaxDeduction(remainingNet,frequency);rate=council.rate;requested=council.amount;
  } else {
    rate=input.deductionType==="percentage"?Math.max(0,input.deductionValue):null;
    requested=input.deductionType==="percentage"?net*Math.max(0,input.deductionValue)/100:Math.max(0,input.deductionValue);
    if(rule==="child-maintenance"||rule==="aeo-priority")requested+=Math.max(0,input.arrears||0);
  }
  const balance=input.balance==null?null:Math.max(0,input.balance);
  const protectionCap=rule==="council-tax-england-wales"?remainingNet:available;
  const deduction=round(Math.min(requested,protectionCap,balance??Number.POSITIVE_INFINITY));
  const componentTotal=ordinaryRequested+maintenanceRequested;
  const ordinaryDeduction=componentTotal?round(Math.min(ordinaryRequested,deduction*ordinaryRequested/componentTotal)):0;
  const maintenanceDeduction=componentTotal?round(Math.max(0,deduction-ordinaryDeduction)):0;
  const ordinaryBalanceAfter=rule==="scottish-conjoined-mixed"
    ?round(Math.max(0,Number(input.ordinaryDebtBalance||0)-ordinaryDeduction)):null;
  // Statutory administration fees may cross the protected-earnings line, but never take pay below zero.
  const fee=deduction>0?round(Math.min(Math.max(0,input.adminFee??1),Math.max(0,remainingNet-deduction))):0;
  const shortfall=round(Math.max(0,requested-deduction));
  return {
    deduction,adminFee:fee,totalFromPay:round(deduction+fee),
    balanceAfter:balance==null?null:round(Math.max(0,balance-deduction)),
    protectedEarnings:round(protectedEarnings),
    rate,shortfall,arrearsAfter:["child-maintenance","aeo-priority"].includes(rule)?shortfall:
      rule==="aeo-non-priority"?0:Math.max(0,input.arrears||0),
    ordinaryDeduction,maintenanceDeduction,ordinaryBalanceAfter,
  };
}

export function attachmentPriority(type:string,explicitPriority=50){
  if(Number.isFinite(explicitPriority)&&explicitPriority!==50)return explicitPriority;
  if(/priority attachment|magistrates.*fine|court fine|earnings arrestment|current maintenance|conjoined maintenance|council tax/i.test(type))return 10;
  if(/child maintenance|\bdeo\b/i.test(type))return 20;
  if(/direct earnings|\bdea\b/i.test(type))return 30;
  return 50;
}
