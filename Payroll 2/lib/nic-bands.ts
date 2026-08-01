export type NicEarningsBands={
  earningsAtLel:number;
  earningsLelToPt:number;
  earningsPtToUel:number;
  earningsAboveUel:number;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function nicEarningsBands(nicablePay:number,earningsPeriod:"monthly"|"weekly"="monthly",periodWeeks=1):NicEarningsBands {
  const weekly=earningsPeriod==="weekly";
  const multiplier=weekly?Math.max(1,Math.round(periodWeeks)):1;
  const earnings=Math.max(0,round(nicablePay)),lel=weekly?129*multiplier:559,pt=weekly?242*multiplier:1048,uel=weekly?967*multiplier:4189;
  if(earnings<lel)return {earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0};
  return {
    earningsAtLel:lel,
    earningsLelToPt:round(Math.min(earnings,pt)-lel),
    earningsPtToUel:round(Math.max(0,Math.min(earnings,uel)-pt)),
    earningsAboveUel:round(Math.max(0,earnings-uel)),
  };
}

export const monthlyNicEarningsBands=(nicablePay:number)=>nicEarningsBands(nicablePay,"monthly");
