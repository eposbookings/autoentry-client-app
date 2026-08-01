export type OrderedHmrcNotice={
  id:number;type:string;employeeId:number|null;taxYear:string;
  issuedDate:string;effectiveDate:string;
  taxCode?:string|null;week1Month1?:boolean|null;
  loanAction?:string|null;studentLoanPlan?:string|null;postgraduateLoan?:boolean|null;
  niNumber?:string|null;message?:string|null;
};

export function compareHmrcNoticePriority(left:OrderedHmrcNotice,right:OrderedHmrcNotice){
  return left.issuedDate.localeCompare(right.issuedDate)
    ||left.effectiveDate.localeCompare(right.effectiveDate)
    ||left.id-right.id;
}

export function hmrcNoticeInstructionKey(notice:OrderedHmrcNotice){
  return JSON.stringify({
    employeeId:notice.employeeId,type:notice.type,taxYear:notice.taxYear,
    effectiveDate:notice.effectiveDate,taxCode:notice.taxCode||null,week1Month1:Boolean(notice.week1Month1),
    loanAction:notice.loanAction||null,studentLoanPlan:notice.studentLoanPlan||null,
    postgraduateLoan:Boolean(notice.postgraduateLoan),niNumber:notice.niNumber||null,
    message:notice.type==="generic"?notice.message?.trim()||null:null,
  });
}
