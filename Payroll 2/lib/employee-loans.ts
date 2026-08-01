export type EmployeeLoanRecoverySource={
  id:number;balance:number;regularDeduction:number;
};

export function allocateEmployeeLoanRecoveries(loans:EmployeeLoanRecoverySource[],availableNetPay:number){
  let available=Math.round(Math.max(0,availableNetPay)*100)/100;
  return [...loans].sort((left,right)=>left.id-right.id).map(loan=>{
    const balanceBefore=Math.round(Math.max(0,Number(loan.balance))*100)/100;
    const amount=Math.round(Math.min(Math.max(0,Number(loan.regularDeduction)),balanceBefore,available)*100)/100;
    const balanceAfter=Math.round((balanceBefore-amount)*100)/100;
    available=Math.round((available-amount)*100)/100;
    return {loan,amount,balanceBefore,balanceAfter};
  }).filter(item=>item.amount>0);
}
