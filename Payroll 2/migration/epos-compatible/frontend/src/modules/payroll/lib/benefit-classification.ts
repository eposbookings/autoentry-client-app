export type BenefitNicTreatment="class-1a"|"class-1"|"exempt";

export const benefitCategories=[
  "Assets transferred",
  "Payments made on behalf of employee",
  "Vouchers and credit cards",
  "Living accommodation",
  "Mileage allowance payments",
  "Company car",
  "Company van",
  "Beneficial loan",
  "Private medical insurance",
  "Qualifying relocation expenses",
  "Services supplied",
  "Assets placed at employee's disposal",
  "Other taxable benefit",
  "Business expenses and allowances",
] as const;

export type BenefitCategory=typeof benefitCategories[number];

const classifications:Record<BenefitCategory,{section:string;defaultNicTreatment:BenefitNicTreatment;label:string}>={
  "Assets transferred":{section:"A",defaultNicTreatment:"class-1a",label:"Assets transferred"},
  "Payments made on behalf of employee":{section:"B",defaultNicTreatment:"class-1a",label:"Payments made on behalf"},
  "Vouchers and credit cards":{section:"C",defaultNicTreatment:"class-1",label:"Vouchers and credit cards"},
  "Living accommodation":{section:"D",defaultNicTreatment:"class-1a",label:"Living accommodation"},
  "Mileage allowance payments":{section:"E",defaultNicTreatment:"exempt",label:"Mileage allowance and passenger payments"},
  "Company car":{section:"F",defaultNicTreatment:"class-1a",label:"Cars and car fuel"},
  "Company van":{section:"G",defaultNicTreatment:"class-1a",label:"Vans and van fuel"},
  "Beneficial loan":{section:"H",defaultNicTreatment:"class-1a",label:"Interest-free and low-interest loans"},
  "Private medical insurance":{section:"I",defaultNicTreatment:"class-1a",label:"Private medical treatment or insurance"},
  "Qualifying relocation expenses":{section:"J",defaultNicTreatment:"class-1a",label:"Qualifying relocation expenses above the exemption"},
  "Services supplied":{section:"K",defaultNicTreatment:"class-1a",label:"Services supplied"},
  "Assets placed at employee's disposal":{section:"L",defaultNicTreatment:"class-1a",label:"Assets placed at the employee's disposal"},
  "Other taxable benefit":{section:"M",defaultNicTreatment:"class-1a",label:"Other items"},
  "Business expenses and allowances":{section:"N",defaultNicTreatment:"class-1",label:"Expenses payments made to, or on behalf of, the employee"},
};

export function classifyBenefit(category:string){
  return classifications[category as BenefitCategory]||null;
}

export function class1aForBenefit(cashEquivalent:number,treatment:BenefitNicTreatment){
  return treatment==="class-1a"?Math.round(Math.max(0,cashEquivalent)*.15*100)/100:0;
}
