import { formatUkDate } from "./uk-date.ts";

export type PayslipLayout="modern"|"classic"|"compact";
export type PayslipFont="arial"|"verdana"|"georgia";

export type PayslipDesign={
  schemaVersion:"payflow-payslip-design-1";
  layout:PayslipLayout;
  accentColour:string;
  font:PayslipFont;
  documentTitle:string;
  footerText:string;
  contactText:string;
  logoAlignment:"left"|"right";
  showEmployerAddress:boolean;
  showEmployeeAddress:boolean;
  showDepartment:boolean;
  showNiNumber:boolean;
  showTaxCode:boolean;
  showPayMethod:boolean;
  showHoursAndRates:boolean;
  showYearToDate:boolean;
  showEmployerContributions:boolean;
};

export const defaultPayslipDesign:PayslipDesign={
  schemaVersion:"payflow-payslip-design-1",layout:"modern",accentColour:"#087b79",font:"arial",
  documentTitle:"Payslip",footerText:"Private and confidential. Please keep this payslip for your records.",contactText:"Questions about this payslip? Contact your payroll team.",logoAlignment:"left",
  showEmployerAddress:true,showEmployeeAddress:true,showDepartment:true,showNiNumber:true,showTaxCode:true,
  showPayMethod:true,showHoursAndRates:true,showYearToDate:true,showEmployerContributions:true,
};

const clean=(value:unknown,max:number)=>String(value??"").trim().slice(0,max);
const bool=(value:unknown,fallback:boolean)=>typeof value==="boolean"?value:fallback;

export function normalisePayslipDesign(value:unknown):PayslipDesign{
  let input:any=value;
  if(typeof value==="string")try{input=JSON.parse(value);}catch{input={};}
  if(!input||typeof input!=="object"||Array.isArray(input))input={};
  const layout:PayslipLayout=["modern","classic","compact"].includes(input.layout)?input.layout:"modern";
  const font:PayslipFont=["arial","verdana","georgia"].includes(input.font)?input.font:"arial";
  const accentColour=/^#[0-9a-f]{6}$/i.test(String(input.accentColour||""))?String(input.accentColour):defaultPayslipDesign.accentColour;
  return {
    schemaVersion:"payflow-payslip-design-1",layout,accentColour,font,
    documentTitle:clean(input.documentTitle,40)||defaultPayslipDesign.documentTitle,
    footerText:clean(input.footerText,240)||defaultPayslipDesign.footerText,
    contactText:clean(input.contactText,160)||defaultPayslipDesign.contactText,
    logoAlignment:input.logoAlignment==="right"?"right":"left",
    showEmployerAddress:bool(input.showEmployerAddress,true),showEmployeeAddress:bool(input.showEmployeeAddress,true),
    showDepartment:bool(input.showDepartment,true),showNiNumber:bool(input.showNiNumber,true),showTaxCode:bool(input.showTaxCode,true),
    showPayMethod:bool(input.showPayMethod,true),showHoursAndRates:bool(input.showHoursAndRates,true),
    showYearToDate:bool(input.showYearToDate,true),showEmployerContributions:bool(input.showEmployerContributions,true),
  };
}

export function validatePayslipDesign(value:unknown){
  let input:any=value;
  if(typeof value==="string")try{input=JSON.parse(value);}catch{return "Payslip design must be valid JSON.";}
  if(!input||typeof input!=="object"||Array.isArray(input))return "Payslip design settings are required.";
  if(input.schemaVersion!==undefined&&input.schemaVersion!=="payflow-payslip-design-1")return "Payslip design version is not supported.";
  if(input.layout!==undefined&&!["modern","classic","compact"].includes(input.layout))return "Select a supported payslip layout.";
  if(input.font!==undefined&&!["arial","verdana","georgia"].includes(input.font))return "Select a supported payslip font.";
  if(input.accentColour!==undefined&&!/^#[0-9a-f]{6}$/i.test(String(input.accentColour)))return "Payslip accent colour must be a six-digit hexadecimal colour.";
  if(clean(input.documentTitle,1000).length>40)return "Payslip title must contain no more than 40 characters.";
  if(clean(input.footerText,1000).length>240)return "Payslip footer must contain no more than 240 characters.";
  if(clean(input.contactText,1000).length>160)return "Payslip contact text must contain no more than 160 characters.";
  return null;
}

export function validPayslipLogo(value:unknown){
  const logo=String(value??"").trim();
  if(!logo)return true;
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(logo)&&logo.length<=700_000;
}

export type PayslipLine={label:string;amount:number;quantity?:number|null;rate?:number|null};
export type PayslipRenderDocument={
  employeeName:string;employeeAddress?:string;payrollId:string;niNumber?:string;taxCode?:string;niCategory?:string;
  department?:string;paymentMethod?:string;periodLabel:string;payDate?:string;taxYear:string;
  payments:PayslipLine[];deductions:PayslipLine[];grossPay:number;taxablePay:number;netPay:number;
  ytd?:{grossPay:number;taxablePay:number;payeTax:number;employeeNic:number;employeePension:number;netPay:number};
  employerContributions?:{employerNic:number;employerPension:number};paymentAfterLeaving?:boolean;
};

export type PayslipRenderBranding={employerName:string;employerAddress?:string;logoUrl?:string|null;design:PayslipDesign};

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const money=(value:unknown)=>`£${Number(value||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const font=(value:PayslipFont)=>value==="georgia"?"Georgia, serif":value==="verdana"?"Verdana, Arial, sans-serif":"Arial, sans-serif";
const lineRows=(lines:PayslipLine[],design:PayslipDesign)=>lines.map(line=>`<tr><td>${esc(line.label)}${design.showHoursAndRates&&line.quantity&&line.rate?`<small>${esc(line.quantity)} × ${money(line.rate)}</small>`:""}</td><td>${money(line.amount)}</td></tr>`).join("")||`<tr><td>No items</td><td>${money(0)}</td></tr>`;

export function renderPayslipHtml(documents:PayslipRenderDocument[],branding:PayslipRenderBranding,checksum?:string){
  const design=normalisePayslipDesign(branding.design),accent=design.accentColour,logo=validPayslipLogo(branding.logoUrl)?String(branding.logoUrl||""):"";
  const pages=documents.map(document=>{
    const employeeMeta=[design.showNiNumber&&document.niNumber?`NI ${esc(document.niNumber)}`:"",design.showTaxCode&&document.taxCode?`Tax code ${esc(document.taxCode)}`:"",document.niCategory?`NI category ${esc(document.niCategory)}`:""].filter(Boolean).join(" · ");
    const logoMarkup=logo?`<img class="logo" src="${logo}" alt="${esc(branding.employerName)} logo">`:"";
    const employerMarkup=`<div class="employer"><strong>${esc(branding.employerName)}</strong>${design.showEmployerAddress&&branding.employerAddress?`<span>${esc(branding.employerAddress)}</span>`:""}</div>`;
    const headerContent=design.logoAlignment==="right"?`${employerMarkup}${logoMarkup}`:`${logoMarkup}${employerMarkup}`;
    return `<section class="payslip ${design.layout}"><header>${headerContent}<div class="document-title"><span>${esc(design.documentTitle)}</span><strong>${esc(document.periodLabel)}</strong></div></header>
      <div class="identity"><div><span>Employee</span><strong>${esc(document.employeeName)}</strong>${design.showEmployeeAddress&&document.employeeAddress?`<small>${esc(document.employeeAddress)}</small>`:""}<small>${employeeMeta}</small></div><div><span>Payroll details</span><b>Payroll ID ${esc(document.payrollId)}</b>${design.showDepartment&&document.department?`<small>${esc(document.department)}</small>`:""}<small>Tax year ${esc(document.taxYear)}</small></div><div><span>Payment</span><b>${formatUkDate(document.payDate,"Not recorded")}</b>${design.showPayMethod&&document.paymentMethod?`<small>${esc(document.paymentMethod.replaceAll("-"," "))}</small>`:""}</div></div>
      ${document.paymentAfterLeaving?`<div class="notice"><b>Payment after leaving</b> This is written confirmation of a post-leaving payment. Your original P45 remains unchanged.</div>`:""}
      <div class="pay-columns"><section><h2>Payments</h2><table><tbody>${lineRows(document.payments,design)}</tbody><tfoot><tr><th>Gross pay</th><th>${money(document.grossPay)}</th></tr></tfoot></table></section><section><h2>Deductions</h2><table><tbody>${lineRows(document.deductions,design)}</tbody><tfoot><tr><th>Total deductions</th><th>${money(document.grossPay-document.netPay)}</th></tr></tfoot></table></section></div>
      <div class="net"><span>Net pay</span><strong>${money(document.netPay)}</strong><small>Taxable pay ${money(document.taxablePay)}</small></div>
      ${design.showYearToDate&&document.ytd?`<section class="support"><h2>Year to date</h2><div><span>Gross pay<b>${money(document.ytd.grossPay)}</b></span><span>Taxable pay<b>${money(document.ytd.taxablePay)}</b></span><span>PAYE tax<b>${money(document.ytd.payeTax)}</b></span><span>Employee NIC<b>${money(document.ytd.employeeNic)}</b></span><span>Pension<b>${money(document.ytd.employeePension)}</b></span><span>Net pay<b>${money(document.ytd.netPay)}</b></span></div></section>`:""}
      ${design.showEmployerContributions&&document.employerContributions?`<section class="employer-cost"><span>Employer contributions (not deducted from pay)</span><b>NIC ${money(document.employerContributions.employerNic)} · Pension ${money(document.employerContributions.employerPension)}</b></section>`:""}
      <footer><p>${esc(design.footerText)}</p><small>${esc(design.contactText)}${checksum?` · Source ${esc(checksum.slice(0,12))}…`:""}</small></footer></section>`;
  }).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(design.documentTitle)}</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#eaf0f2;color:#17313b;font-family:${font(design.font)}}.payslip{width:190mm;min-height:277mm;margin:8mm auto;padding:13mm;background:#fff;border-top:7px solid ${accent};page-break-after:always;box-shadow:0 6px 24px #17313b18}.payslip header{display:flex;align-items:center;gap:16px;border-bottom:1px solid #d8e3e6;padding-bottom:14px}.logo{max-width:46mm;max-height:18mm;object-fit:contain}.employer{display:flex;flex:1;flex-direction:column;gap:3px}.employer strong{font-size:20px;color:${accent}}.employer span,.identity small{color:#61757d;font-size:11px}.document-title{text-align:right}.document-title span{display:block;color:${accent};font-size:22px;font-weight:800}.document-title strong{font-size:12px}.identity{display:grid;grid-template-columns:1.5fr 1fr .85fr;gap:18px;margin:18px 0;padding:13px;background:#f3f7f8;border-radius:8px}.identity>div{display:flex;flex-direction:column;gap:4px}.identity>div>span,.support h2,.pay-columns h2{color:#60757d;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.identity strong{font-size:16px}.notice{margin:0 0 14px;padding:10px 12px;border-left:4px solid #c98913;background:#fff4dc;font-size:12px}.pay-columns{display:grid;grid-template-columns:1fr 1fr;gap:22px}.pay-columns section{border:1px solid #d9e3e6;border-radius:8px;overflow:hidden}.pay-columns h2{margin:0;padding:10px 12px;background:#f4f7f8}table{width:100%;border-collapse:collapse}td,th{padding:8px 12px;border-top:1px solid #e4ebed;text-align:left;font-size:12px}td:last-child,th:last-child{text-align:right}td small{display:block;color:#74868d;margin-top:2px}tfoot th{font-size:13px;color:${accent}}.net{display:flex;align-items:baseline;gap:12px;margin:18px 0;padding:14px 18px;border-radius:8px;background:${accent};color:#fff}.net span{font-size:16px;font-weight:700}.net strong{font-size:27px;margin-left:auto}.net small{font-size:11px}.support{margin-top:14px;border-top:1px solid #d8e3e6;padding-top:12px}.support h2{margin:0 0 8px}.support>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.support span{display:flex;justify-content:space-between;padding:7px;background:#f4f7f8;font-size:11px}.support b{color:#213e49}.employer-cost{display:flex;justify-content:space-between;margin-top:12px;padding:10px 12px;border:1px dashed ${accent};font-size:11px}.payslip footer{margin-top:20px;border-top:1px solid #d8e3e6;padding-top:10px;color:#60757d;font-size:10px}.payslip footer p{margin:0 0 4px}.classic{border:1px solid #b9c9ce;border-top:3px double ${accent}}.classic .identity,.classic .pay-columns section{border-radius:0}.classic .net{border-radius:0;background:#eef5f5;color:#17313b;border:2px solid ${accent}}.compact{padding:9mm;min-height:auto}.compact .identity{margin:10px 0;padding:9px}.compact td,.compact th{padding:5px 9px}.compact .net{margin:10px 0;padding:9px 13px}.compact .support>div{grid-template-columns:repeat(6,1fr)}.compact .support span{display:block}.compact .support b{display:block;margin-top:3px}@media print{body{background:#fff}.payslip{margin:0;box-shadow:none}}</style></head><body>${pages}</body></html>`;
}
