import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { employeePortalSessions } from "../db/schema";

export async function hashSecret(value:string) {
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export function randomSecret() {
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return Array.from(bytes).map(byte=>byte.toString(36).padStart(2,"0")).join("").toUpperCase();
}

function cookieValue(request:Request,name:string) {
  const cookie=request.headers.get("cookie")||"";
  return cookie.split(";").map(part=>part.trim()).find(part=>part.startsWith(`${name}=`))?.slice(name.length+1)||"";
}

export async function portalSession(request:Request) {
  const token=cookieValue(request,"payflow_portal");
  if(!token)return null;
  const hash=await hashSecret(token),now=new Date().toISOString();
  const [session]=await getDb().select().from(employeePortalSessions).where(and(
    eq(employeePortalSessions.tokenHash,hash),gt(employeePortalSessions.expiresAt,now),isNull(employeePortalSessions.revokedAt),
  )).limit(1);
  return session?{sessionId:session.id,employeeId:session.employeeId}:null;
}

export async function portalEmployeeId(request:Request) {
  return (await portalSession(request))?.employeeId||null;
}
