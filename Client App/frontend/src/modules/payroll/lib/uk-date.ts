const isoDatePrefix = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

function validUtcDate(year:number, month:number, day:number){
  const value=new Date(Date.UTC(year,month-1,day));
  return value.getUTCFullYear()===year&&value.getUTCMonth()===month-1&&value.getUTCDate()===day;
}

/** Format stored ISO dates for people. Storage and filing payloads remain ISO. */
export function formatUkDate(value:unknown,fallback="—"){
  const text=String(value??"").trim();
  if(!text)return fallback;
  const match=text.match(isoDatePrefix);
  if(match){
    const [,yearText,monthText,dayText]=match,year=Number(yearText),month=Number(monthText),day=Number(dayText);
    if(!validUtcDate(year,month,day))return fallback;
    return `${dayText}/${monthText}/${yearText}`;
  }
  const parsed=new Date(text);
  return Number.isFinite(parsed.getTime())
    ?new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(parsed)
    :fallback;
}

export function formatUkDateTime(value:unknown,fallback="—"){
  const text=String(value??"").trim();
  if(!text)return fallback;
  const parsed=new Date(/^\d{4}-\d{2}-\d{2}$/.test(text)?`${text}T00:00:00Z`:text);
  return Number.isFinite(parsed.getTime())
    ?new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Europe/London"}).format(parsed)
    :fallback;
}
