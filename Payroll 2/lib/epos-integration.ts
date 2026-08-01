export type EposPayrollContext={
  employerId:number;
  clientId:string;
  practiceId:string;
  userId:string;
  email:string;
  displayName:string;
  role:string;
  canViewConfidential:boolean;
  exp:number;
};

const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");

function decodeBase64Url(value:string){
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  const binary=atob(normalized);
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
}

function equalHex(left:string,right:string){
  if(left.length!==right.length)return false;
  let mismatch=0;
  for(let index=0;index<left.length;index++)mismatch|=left.charCodeAt(index)^right.charCodeAt(index);
  return mismatch===0;
}

export async function trustedEposContext(request:Request,expectedEmployerId?:number):Promise<EposPayrollContext|null>{
  const secret=process.env.PAYROLL_INTEGRATION_SECRET||"";
  if(secret.length<32)return null;
  const encoded=request.headers.get("x-epos-payroll-context")||"";
  const suppliedSignature=(request.headers.get("x-epos-payroll-signature")||"").toLowerCase();
  if(!encoded||!/^[a-f0-9]{64}$/.test(suppliedSignature))return null;
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const actualSignature=hex(await crypto.subtle.sign("HMAC",key,encoder.encode(encoded)));
  if(!equalHex(actualSignature,suppliedSignature))return null;
  try{
    const context=JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as EposPayrollContext;
    if(!context||typeof context!=="object"||!context.clientId||!context.practiceId||!context.userId)return null;
    if(!Number.isFinite(context.exp)||context.exp<Math.floor(Date.now()/1000))return null;
    if(!Number.isInteger(context.employerId)||context.employerId<0)return null;
    if(expectedEmployerId!==undefined&&context.employerId!==expectedEmployerId)return null;
    return context;
  }catch{return null;}
}

export function payrollRoleForEpos(role:string){
  if(["admin","practice_admin"].includes(role))return "admin";
  if(["practice_manager","practice_staff"].includes(role))return "payroll";
  return "viewer";
}
