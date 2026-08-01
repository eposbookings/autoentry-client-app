export const APPRENTICESHIP_LEVY_RATE = 0.005;
export const APPRENTICESHIP_LEVY_ANNUAL_ALLOWANCE = 15_000;

const round = (value:number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function apprenticeshipLevyByMonth(
  monthlyPayBills:number[],
  enabled:boolean,
  annualAllowance=APPRENTICESHIP_LEVY_ANNUAL_ALLOWANCE,
) {
  let cumulativePayBill=0;
  let previousCumulativeDue=0;
  return monthlyPayBills.map((rawPayBill,index)=>{
    const payBill=round(Math.max(0,Number(rawPayBill)||0));
    cumulativePayBill=round(cumulativePayBill+payBill);
    const cumulativeGrossLevy=round(cumulativePayBill*APPRENTICESHIP_LEVY_RATE);
    const cumulativeAllowance=round(Math.max(0,annualAllowance)*(index+1)/12);
    const cumulativeDue=enabled?round(Math.max(0,cumulativeGrossLevy-cumulativeAllowance)):0;
    const currentDue=round(Math.max(0,cumulativeDue-previousCumulativeDue));
    previousCumulativeDue=cumulativeDue;
    return {payBill,cumulativePayBill,cumulativeGrossLevy,cumulativeAllowance,currentDue,cumulativeDue};
  });
}
