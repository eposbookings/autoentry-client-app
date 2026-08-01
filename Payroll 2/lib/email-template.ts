export const emailTemplateTokens=[
  "name","forename","surname","title","employee id","preferred name","report","period","report+period",
  "employer","payeref","accountsref","contact","contact forename","contact surname","user reference",
  "agent","agent contact","agent contact forename","agent contact surname",
] as const;

const allowedTokens=new Set<string>(emailTemplateTokens);

export type EmailTemplateContext=Partial<Record<typeof emailTemplateTokens[number],string|number>>;

export function validateEmailTemplate(input:{name:unknown;subject:unknown;body:unknown;reportType?:unknown}):string|null {
  const name=String(input.name||"").trim(),subject=String(input.subject||"").trim(),body=String(input.body||"").trim();
  if(name.length<1||name.length>80)return "Email template name must contain 1 to 80 characters.";
  if(subject.length<1||subject.length>200)return "Email subject must contain 1 to 200 characters.";
  if(body.length<1||body.length>4000)return "Email message must contain 1 to 4,000 characters.";
  if(input.reportType!==undefined&&!["payslip","p60","general"].includes(String(input.reportType)))
    return "Email template report type must be payslip, P60 or general.";
  const tokens=[...`${subject}\n${body}`.matchAll(/<([^<>]+)>/g)].map(match=>match[1].trim().toLowerCase());
  const invalid=tokens.find(token=>!allowedTokens.has(token));
  if(invalid)return `Email template contains unsupported token <${invalid}>.`;
  return null;
}

export function renderEmailTemplate(value:string,context:EmailTemplateContext){
  return value.replace(/<([^<>]+)>/g,(match,rawToken)=>{
    const token=String(rawToken).trim().toLowerCase() as keyof EmailTemplateContext;
    return Object.prototype.hasOwnProperty.call(context,token)?String(context[token]??""):match;
  });
}

export function parseStoredEmailTemplate(value:unknown){
  let template:any;
  try{template=JSON.parse(String(value||""));}catch{return null;}
  if(!template||typeof template!=="object"||Array.isArray(template)||validateEmailTemplate(template))return null;
  return {
    schemaVersion:"payflow-email-template-1",
    name:String(template.name).trim(),reportType:String(template.reportType||"payslip"),
    subject:String(template.subject).trim(),body:String(template.body).trim(),
    isDefault:template.isDefault===true,
  };
}
