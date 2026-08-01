export type BeneficialLoanInput={
  taxYear:string;openingBalance:number;closingBalance:number;maximumAggregateBalance:number;
  wholeMonthsOutstanding:number;interestPaid:number;salaryForegone?:number;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const officialRates:Record<string,number>={"2025/26":3.75,"2026/27":3.75};

export function calculateBeneficialLoan(input:BeneficialLoanInput){
  const officialRate=officialRates[input.taxYear];
  if(!officialRate)throw new Error("Automatic beneficial-loan rates are available for tax years 2025/26 and 2026/27.");
  const amounts=[input.openingBalance,input.closingBalance,input.maximumAggregateBalance,input.interestPaid,input.salaryForegone||0];
  if(amounts.some(value=>!Number.isFinite(value)||value<0))throw new Error("Beneficial-loan balances, interest and salary foregone must be non-negative amounts.");
  if(input.maximumAggregateBalance<Math.max(input.openingBalance,input.closingBalance))throw new Error("Maximum aggregate balance cannot be below the opening or closing balance.");
  if(!Number.isInteger(input.wholeMonthsOutstanding)||input.wholeMonthsOutstanding<1||input.wholeMonthsOutstanding>12)throw new Error("Whole months outstanding must be between 1 and 12.");
  const averageBalance=round((input.openingBalance+input.closingBalance)/2);
  const officialInterest=round(averageBalance*input.wholeMonthsOutstanding/12*officialRate/100);
  const smallLoanExempt=input.maximumAggregateBalance<=10000&&!input.salaryForegone;
  const normalBenefit=smallLoanExempt?0:round(Math.max(0,officialInterest-input.interestPaid));
  const opraBenefit=input.salaryForegone?round(Math.max(0,input.salaryForegone-input.interestPaid)):0;
  const cashEquivalent=input.salaryForegone?Math.max(normalBenefit,opraBenefit):normalBenefit;
  return {officialRate,averageBalance,officialInterest,smallLoanExempt,normalBenefit,opraBenefit,cashEquivalent,class1aNic:round(cashEquivalent*.15)};
}
