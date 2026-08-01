const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export const cashRoundingUnits=[1,5,10] as const;
export type CashRoundingUnit=typeof cashRoundingUnits[number];

export function isCashRoundingUnit(value:unknown):value is CashRoundingUnit {
  return cashRoundingUnits.includes(Number(value) as CashRoundingUnit);
}

export function applyCashPayRounding(input:{netPay:number;openingCarry:number;unit:number}) {
  const netPay=money(Number(input.netPay)),openingCarry=money(Number(input.openingCarry)),unit=Number(input.unit);
  if(!Number.isFinite(netPay)||netPay<0||!Number.isFinite(openingCarry)||openingCarry<0)
    throw new Error("Cash pay and opening carry must be non-negative amounts.");
  if(!isCashRoundingUnit(unit))throw new Error("Cash pay can be rounded only to £1, £5 or £10.");
  const exactDue=money(netPay+openingCarry);
  const roundedNet=money(Math.floor((exactDue+1e-9)/unit)*unit);
  const closingCarry=money(exactDue-roundedNet);
  return {netPay,openingCarry,unit,exactDue,roundedNet,closingCarry,adjustment:money(roundedNet-netPay)};
}
