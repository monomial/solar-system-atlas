const OBJECTS={Ceres:"1",Pluto:"134340",Haumea:"136108",Makemake:"136472",Eris:"136199"} as const;

function nextDay(value:string){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);}

async function position(id:string,date:string){
  const params=new URLSearchParams({format:"json",COMMAND:`'${id};'`,OBJ_DATA:"NO",MAKE_EPHEM:"YES",EPHEM_TYPE:"VECTORS",CENTER:"'500@10'",START_TIME:`'${date}'`,STOP_TIME:`'${nextDay(date)}'`,STEP_SIZE:"'1 d'",OUT_UNITS:"'AU-D'",REF_PLANE:"'ECLIPTIC'",VEC_TABLE:"'2'",CSV_FORMAT:"YES"});
  const response=await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`,{headers:{Accept:"application/json"}});
  if(!response.ok)throw new Error(`Horizons returned ${response.status}`);
  const payload=await response.json() as {result?:string;error?:string};
  if(payload.error||!payload.result)throw new Error(payload.error??"Missing Horizons result");
  const row=payload.result.split("$$SOE")[1]?.split("$$EOE")[0]?.split("\n").find(line=>line.includes("A.D."));
  if(!row)throw new Error("Missing vector row");
  const columns=row.split(",").map(value=>value.trim());
  return [Number(columns[2]),Number(columns[3]),Number(columns[4])] as [number,number,number];
}

export async function GET(request:Request){
  const date=new URL(request.url).searchParams.get("date")??"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<"1800-01-01"||date>"2050-12-31")return Response.json({error:"Date must be between 1800-01-01 and 2050-12-31"},{status:400});
  try{
    const entries:[string,[number,number,number]][]=[];
    // Horizons rate-limits bursts; a tiny sequential queue is much more reliable than five concurrent requests.
    for(const [name,id] of Object.entries(OBJECTS))entries.push([name,await position(id,date)]);
    return Response.json({date,source:"NASA/JPL Horizons",positions:Object.fromEntries(entries)},{headers:{"Cache-Control":"public, max-age=86400"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Horizons request failed"},{status:502});
  }
}
