export type PreparedEmployerImport = {
  rowNumber:number;
  name:string;
  legalName:string;
  address:string;
  postcode:string;
  payeReference:string;
  accountsOfficeReference:string;
  companyNumber:string;
  taxYear:string;
  cisContractor:boolean;
  cisUtr:string;
  smallEmployersRelief:boolean;
  employmentAllowance:boolean;
  apprenticeshipLevy:boolean;
  typicalPayBasis:"period"|"hourly"|"daily";
  typicalAnnualLeaveDays:number;
  typicalWeeklyHours:number;
  minimumHourlyRate:number;
  autoWorksNumber:boolean;
  nextWorksNumber:number;
  clientStatus:"active"|"inactive"|"onboarding"|"archived";
  managedBy:string;
  colourReference:string;
  primaryContactName:string;
  primaryContactEmail:string;
  primaryContactPhone:string;
  documentPasswordStrategy:"employee-postcode"|"employee-ni-last4"|"manual-per-document";
};

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const payePattern=/^\d{3}\/[A-Z0-9]{1,10}$/i;
const accountsOfficePattern=/^\d{3}P[A-Z0-9]\d{8}$/i;
const companyNumberPattern=/^(?:[A-Z]{2}\d{6}|\d{8})$/i;
const postcodePattern=/^(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i;
const clean=(value:unknown)=>String(value??"").trim();
const normalized=(value:unknown)=>clean(value).toLowerCase();
const validTaxYear=(value:string)=>{
  const match=/^(\d{4})\/(\d{2})$/.exec(value);
  return Boolean(match&&Number(match[2])===(Number(match[1])+1)%100);
};
const booleanValue=(value:unknown)=>{
  const text=normalized(value);
  if(["true","yes","y","1"].includes(text))return true;
  if(["false","no","n","0",""].includes(text))return false;
  return null;
};
const numberValue=(value:unknown,fallback:number)=>{
  const text=clean(value);
  return text===""?fallback:Number(text);
};

export function validateEmployerImportRows(
  rows:Record<string,unknown>[],
  existing?:{names?:Iterable<string>;payeReferences?:Iterable<string>;accountsOfficeReferences?:Iterable<string>},
){
  const errors:string[]=[];
  const prepared:PreparedEmployerImport[]=[];
  if(!Array.isArray(rows)||rows.length<1)return {prepared,errors:["Employer CSV must contain at least one data row."]};
  if(rows.length>100)return {prepared,errors:["Employer CSV may contain no more than 100 clients."]};
  const existingNames=new Set(Array.from(existing?.names||[],normalized));
  const existingPaye=new Set(Array.from(existing?.payeReferences||[],normalized).filter(Boolean));
  const existingAccounts=new Set(Array.from(existing?.accountsOfficeReferences||[],normalized).filter(Boolean));
  const fileNames=new Set<string>(),filePaye=new Set<string>(),fileAccounts=new Set<string>();
  rows.forEach((row,index)=>{
    const prefix=`Row ${index+2}:`;
    const name=clean(row.name),legalName=clean(row.legalName)||name,address=clean(row.address),postcode=clean(row.postcode).toUpperCase();
    const payeReference=clean(row.payeReference).toUpperCase(),accountsOfficeReference=clean(row.accountsOfficeReference).replace(/\s/g,"").toUpperCase();
    const companyNumber=clean(row.companyNumber).replace(/\s/g,"").toUpperCase(),taxYear=clean(row.taxYear)||"2026/27";
    const cisUtr=clean(row.cisUtr).replace(/\s/g,""),primaryContactEmail=normalized(row.primaryContactEmail);
    const typicalPayBasis=(normalized(row.typicalPayBasis)||"period") as PreparedEmployerImport["typicalPayBasis"];
    const clientStatus=(normalized(row.clientStatus)||"onboarding") as PreparedEmployerImport["clientStatus"];
    const documentPasswordStrategy=(normalized(row.documentPasswordStrategy)||"employee-postcode") as PreparedEmployerImport["documentPasswordStrategy"];
    const typicalAnnualLeaveDays=numberValue(row.typicalAnnualLeaveDays,28);
    const typicalWeeklyHours=numberValue(row.typicalWeeklyHours,37.5);
    const minimumHourlyRate=numberValue(row.minimumHourlyRate,12.71);
    const nextWorksNumber=numberValue(row.nextWorksNumber,1);
    const cisContractor=booleanValue(row.cisContractor),smallEmployersRelief=booleanValue(row.smallEmployersRelief);
    const employmentAllowance=booleanValue(row.employmentAllowance),apprenticeshipLevy=booleanValue(row.apprenticeshipLevy);
    const autoWorksNumber=clean(row.autoWorksNumber)===""?true:booleanValue(row.autoWorksNumber);
    const nameKey=normalized(name),payeKey=normalized(payeReference),accountsKey=normalized(accountsOfficeReference);
    if(!name||name.length>200)errors.push(`${prefix} employer name is required and must contain no more than 200 characters.`);
    else{
      if(existingNames.has(nameKey))errors.push(`${prefix} an employer with this name already exists.`);
      if(fileNames.has(nameKey))errors.push(`${prefix} employer name is duplicated in this file.`);
    }
    if(legalName.length>200)errors.push(`${prefix} legal name must contain no more than 200 characters.`);
    if(address.length>500)errors.push(`${prefix} address must contain no more than 500 characters.`);
    if(postcode&&!postcodePattern.test(postcode))errors.push(`${prefix} postcode is not a recognised UK format.`);
    if(payeReference&&!payePattern.test(payeReference))errors.push(`${prefix} PAYE reference must use the format 123/AB456.`);
    else if(payeKey){
      if(existingPaye.has(payeKey))errors.push(`${prefix} PAYE reference already belongs to an employer.`);
      if(filePaye.has(payeKey))errors.push(`${prefix} PAYE reference is duplicated in this file.`);
    }
    if(accountsOfficeReference&&!accountsOfficePattern.test(accountsOfficeReference))errors.push(`${prefix} Accounts Office reference must contain 13 valid characters.`);
    else if(accountsKey){
      if(existingAccounts.has(accountsKey))errors.push(`${prefix} Accounts Office reference already belongs to an employer.`);
      if(fileAccounts.has(accountsKey))errors.push(`${prefix} Accounts Office reference is duplicated in this file.`);
    }
    if(companyNumber&&!companyNumberPattern.test(companyNumber))errors.push(`${prefix} company number must contain eight valid characters.`);
    if(!validTaxYear(taxYear))errors.push(`${prefix} tax year must be consecutive and use the format 2026/27.`);
    if(cisContractor===null)errors.push(`${prefix} CIS contractor must be true or false.`);
    if(cisContractor===true&&!/^\d{10}$/.test(cisUtr))errors.push(`${prefix} a CIS contractor requires a 10-digit UTR.`);
    if(smallEmployersRelief===null)errors.push(`${prefix} Small Employers’ Relief must be true or false.`);
    if(employmentAllowance===null)errors.push(`${prefix} Employment Allowance must be true or false.`);
    if(apprenticeshipLevy===null)errors.push(`${prefix} Apprenticeship Levy must be true or false.`);
    if(autoWorksNumber===null)errors.push(`${prefix} automatic works numbers must be true or false.`);
    if(!["period","hourly","daily"].includes(typicalPayBasis))errors.push(`${prefix} typical pay basis must be period, hourly or daily.`);
    if(!Number.isFinite(typicalAnnualLeaveDays)||typicalAnnualLeaveDays<0||typicalAnnualLeaveDays>366)errors.push(`${prefix} typical annual leave must be between 0 and 366 days.`);
    if(!Number.isFinite(typicalWeeklyHours)||typicalWeeklyHours<0||typicalWeeklyHours>168)errors.push(`${prefix} typical weekly hours must be between 0 and 168.`);
    if(!Number.isFinite(minimumHourlyRate)||minimumHourlyRate<0||minimumHourlyRate>100000)errors.push(`${prefix} minimum hourly rate must be a valid non-negative amount.`);
    if(!Number.isInteger(nextWorksNumber)||nextWorksNumber<1||nextWorksNumber>999999999)errors.push(`${prefix} next works number must be a whole number between 1 and 999999999.`);
    if(!["active","inactive","onboarding","archived"].includes(clientStatus))errors.push(`${prefix} client status must be active, inactive, onboarding or archived.`);
    const colourReference=clean(row.colourReference)||"#087b79";
    if(!/^#[0-9a-f]{6}$/i.test(colourReference))errors.push(`${prefix} tracking colour must be a six-digit hexadecimal colour.`);
    if(primaryContactEmail&&!emailPattern.test(primaryContactEmail))errors.push(`${prefix} primary contact email is invalid.`);
    if(clean(row.primaryContactName).length>200||clean(row.primaryContactPhone).length>50||clean(row.managedBy).length>200)
      errors.push(`${prefix} contact and manager fields exceed their supported length.`);
    if(!["employee-postcode","employee-ni-last4","manual-per-document"].includes(documentPasswordStrategy))
      errors.push(`${prefix} document password strategy is unsupported.`);
    if(nameKey)fileNames.add(nameKey);
    if(payeKey)filePaye.add(payeKey);
    if(accountsKey)fileAccounts.add(accountsKey);
    prepared.push({
      rowNumber:index+2,name,legalName,address,postcode,payeReference,accountsOfficeReference,companyNumber,taxYear,
      cisContractor:cisContractor===true,cisUtr,smallEmployersRelief:smallEmployersRelief===true,
      employmentAllowance:employmentAllowance===true,apprenticeshipLevy:apprenticeshipLevy===true,
      typicalPayBasis,typicalAnnualLeaveDays,typicalWeeklyHours,minimumHourlyRate,
      autoWorksNumber:autoWorksNumber!==false,nextWorksNumber,clientStatus,managedBy:clean(row.managedBy),
      colourReference,primaryContactName:clean(row.primaryContactName),primaryContactEmail,
      primaryContactPhone:clean(row.primaryContactPhone),documentPasswordStrategy,
    });
  });
  return {prepared,errors};
}
