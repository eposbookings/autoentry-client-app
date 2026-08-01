export type P45OpeningEvidence={
  previousPay:number;
  previousTax:number;
  source:"finalised-payroll"|"employee-fallback";
};

const finiteNonNegative=(value:unknown)=>{
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?number:0;
};

export function p45OpeningFromFinalisedSnapshots(
  snapshots:Array<Record<string,unknown>>,
  fallback:{previousPay?:unknown;previousTax?:unknown},
):P45OpeningEvidence {
  const latest=[...snapshots].reverse().find(snapshot=>
    Object.prototype.hasOwnProperty.call(snapshot,"p45PreviousPay")&&
    Object.prototype.hasOwnProperty.call(snapshot,"p45PreviousTax"),
  );
  if(latest)return {
    previousPay:finiteNonNegative(latest.p45PreviousPay),
    previousTax:finiteNonNegative(latest.p45PreviousTax),
    source:"finalised-payroll",
  };
  return {
    previousPay:finiteNonNegative(fallback.previousPay),
    previousTax:finiteNonNegative(fallback.previousTax),
    source:"employee-fallback",
  };
}
