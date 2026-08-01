export const encryptedBackupFormat="payflow-encrypted-backup" as const;
export const encryptedBackupVersion=1 as const;
export const backupKdfIterations=310_000;

export type EncryptedPayrollBackup={
  format:typeof encryptedBackupFormat;
  version:typeof encryptedBackupVersion;
  employerId:number;
  createdAt:string;
  kdf:{name:"PBKDF2";hash:"SHA-256";iterations:number;salt:string};
  cipher:{name:"AES-GCM";iv:string};
  ciphertext:string;
};

const encoder=new TextEncoder(),decoder=new TextDecoder();
const toArrayBuffer=(bytes:Uint8Array)=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
const toBase64=(bytes:Uint8Array)=>{
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=0x8000)
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
};
const fromBase64=(value:string)=>{
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4!==0)throw new Error("Encrypted backup encoding is invalid.");
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
};
const assertPassword=(password:string)=>{
  if(password.length<12||password.length>200)throw new Error("Backup passwords must contain between 12 and 200 characters.");
};
const deriveKey=async(password:string,salt:Uint8Array,usage:KeyUsage[])=>{
  const material=await crypto.subtle.importKey("raw",toArrayBuffer(encoder.encode(password)),{name:"PBKDF2"},false,["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",hash:"SHA-256",iterations:backupKdfIterations,salt:toArrayBuffer(salt)},
    material,{name:"AES-GCM",length:256},false,usage,
  );
};
const additionalData=(employerId:number)=>encoder.encode(`${encryptedBackupFormat}:${encryptedBackupVersion}:${employerId}`);

export const isEncryptedPayrollBackup=(value:unknown):value is EncryptedPayrollBackup=>
  Boolean(value&&typeof value==="object"&&(value as any).format===encryptedBackupFormat&&(value as any).version===encryptedBackupVersion);

export async function encryptPayrollBackup(backup:any,password:string):Promise<EncryptedPayrollBackup>{
  assertPassword(password);
  if(!backup||typeof backup!=="object"||!Number.isInteger(backup.employerId)||backup.employerId<=0)
    throw new Error("Only a complete employer backup can be password-protected.");
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt,["encrypt"]);
  const ciphertext=await crypto.subtle.encrypt(
    {name:"AES-GCM",iv:toArrayBuffer(iv),additionalData:toArrayBuffer(additionalData(backup.employerId))},
    key,toArrayBuffer(encoder.encode(JSON.stringify(backup))),
  );
  return {
    format:encryptedBackupFormat,version:encryptedBackupVersion,employerId:backup.employerId,createdAt:new Date().toISOString(),
    kdf:{name:"PBKDF2",hash:"SHA-256",iterations:backupKdfIterations,salt:toBase64(salt)},
    cipher:{name:"AES-GCM",iv:toBase64(iv)},ciphertext:toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptPayrollBackup(value:unknown,password:string,expectedEmployerId?:number){
  assertPassword(password);
  if(!isEncryptedPayrollBackup(value))throw new Error("This is not a supported encrypted PayFlow backup.");
  const backup=value as EncryptedPayrollBackup;
  if(!Number.isInteger(backup.employerId)||backup.employerId<=0||
    expectedEmployerId!==undefined&&backup.employerId!==expectedEmployerId||
    backup.kdf?.name!=="PBKDF2"||backup.kdf?.hash!=="SHA-256"||backup.kdf?.iterations!==backupKdfIterations||
    backup.cipher?.name!=="AES-GCM")
    throw new Error("Encrypted backup metadata is invalid or belongs to another employer.");
  try{
    const salt=fromBase64(backup.kdf.salt),iv=fromBase64(backup.cipher.iv),ciphertext=fromBase64(backup.ciphertext);
    if(salt.length!==16||iv.length!==12||ciphertext.length<17)throw new Error("invalid");
    const key=await deriveKey(password,salt,["decrypt"]);
    const plaintext=await crypto.subtle.decrypt(
      {name:"AES-GCM",iv:toArrayBuffer(iv),additionalData:toArrayBuffer(additionalData(backup.employerId))},
      key,toArrayBuffer(ciphertext),
    );
    const decoded=JSON.parse(decoder.decode(plaintext));
    if(!decoded||typeof decoded!=="object"||decoded.employerId!==backup.employerId)throw new Error("invalid");
    return decoded;
  }catch{
    throw new Error("The encrypted backup could not be opened. Check the password and file integrity.");
  }
}
