import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { adminSessions, adminUsers, employerMemberships } from "../db/schema";
import { payrollRoleForEpos, trustedEposContext } from "./epos-integration";
export type AdminPermission="read"|"payroll-write"|"employee-write"|"employer-admin"|"confidential-read";
const rolePermissions:Record<string,AdminPermission[]>={
  owner:["read","payroll-write","employee-write","employer-admin","confidential-read"],
  admin:["read","payroll-write","employee-write","employer-admin","confidential-read"],
  payroll:["read","payroll-write","employee-write","confidential-read"],
  manager:["read","employee-write"],
  viewer:["read"],
};
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
export const sessionCookie="pf_admin_session";

export async function sha256(value:string){return hex(await crypto.subtle.digest("SHA-256",encoder.encode(value)));}
export function randomToken(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
export async function hashPassword(password:string,salt=randomToken().slice(0,32)){
  const material=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:120000},material,256);
  return `pbkdf2-sha256$120000$${salt}$${hex(bits)}`;
}
export async function verifyPassword(password:string,stored:string){
  const [algorithm,iterations,salt,digest]=stored.split("$");
  if(algorithm!=="pbkdf2-sha256"||!iterations||!salt||!digest)return false;
  const material=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:Number(iterations)},material,256);
  const actual=hex(bits);let mismatch=actual.length===digest.length?0:1;
  for(let i=0;i<Math.min(actual.length,digest.length);i++)mismatch|=actual.charCodeAt(i)^digest.charCodeAt(i);
  return mismatch===0;
}
function cookie(request:Request,name:string){
  const header=request.headers.get("cookie")||"";
  return header.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||"";
}
export async function currentAdmin(request:Request){
  const trusted=await trustedEposContext(request);
  if(trusted)return {sessionId:0,userId:0,email:trusted.email,displayName:trusted.displayName,epos:trusted};
  const token=cookie(request,sessionCookie);
  if(!token)return null;
  const tokenHash=await sha256(token),now=new Date().toISOString(),db=getDb();
  const [row]=await db.select({
    sessionId:adminSessions.id,userId:adminUsers.id,email:adminUsers.email,displayName:adminUsers.displayName,
  }).from(adminSessions).innerJoin(adminUsers,eq(adminSessions.userId,adminUsers.id)).where(and(
    eq(adminSessions.tokenHash,tokenHash),isNull(adminSessions.revokedAt),gt(adminSessions.expiresAt,now),eq(adminUsers.status,"active"),
  )).limit(1);
  return row||null;
}
export async function requireEmployerAccess(request:Request,employerId:number,permission:AdminPermission="read"){
  if(!Number.isInteger(employerId)||employerId<=0)return {ok:false as const,response:NextResponse.json({error:"A valid employer is required."},{status:400})};
  const trusted=await trustedEposContext(request,employerId);
  if(trusted){
    const membership={employerId,userId:0,role:payrollRoleForEpos(trusted.role),canViewConfidential:trusted.canViewConfidential,status:"active"};
    const allowed=rolePermissions[membership.role]||[];
    if(!allowed.includes(permission))return {ok:false as const,response:NextResponse.json({error:"Your EPOS role does not permit this payroll action."},{status:403})};
    if(permission==="confidential-read"&&!membership.canViewConfidential)return {ok:false as const,response:NextResponse.json({error:"Confidential employee access is required."},{status:403})};
    return {ok:true as const,mode:"epos" as const,user:{sessionId:0,userId:0,email:trusted.email,displayName:trusted.displayName},membership};
  }
  const user=await currentAdmin(request);
  if(!user)return {ok:false as const,response:NextResponse.json({error:"Administrator sign-in is required."},{status:401})};
  const [membership]=await getDb().select().from(employerMemberships).where(and(
    eq(employerMemberships.employerId,employerId),eq(employerMemberships.userId,user.userId),eq(employerMemberships.status,"active"),
  )).limit(1);
  if(!membership)return {ok:false as const,response:NextResponse.json({error:"You do not have access to this employer."},{status:403})};
  const allowed=rolePermissions[membership.role]||[];
  if(!allowed.includes(permission))return {ok:false as const,response:NextResponse.json({error:"Your role does not permit this action."},{status:403})};
  if(permission==="confidential-read"&&!membership.canViewConfidential)return {ok:false as const,response:NextResponse.json({error:"Confidential employee access is required."},{status:403})};
  return {ok:true as const,mode:"standalone" as const,user,membership};
}
