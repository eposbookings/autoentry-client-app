export async function readJsonObject(request:Request):Promise<Record<string,any>|null> {
  try {
    const input=await request.json();
    return input&&typeof input==="object"&&!Array.isArray(input)?input:null;
  } catch {
    return null;
  }
}
