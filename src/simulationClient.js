const API = import.meta.env.VITE_SIM_API || "http://127.0.0.1:8765/api";
async function req(path, options={}) {
  const response=await fetch(`${API}${path}`,{headers:{"Content-Type":"application/json"},...options});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error||`Simulation API ${response.status}`);
  return payload;
}
export const simulationClient={
  health:()=>req("/health"),
  listSessions:()=>req("/sessions"),
  createSimulation:config=>req("/simulations",{method:"POST",body:JSON.stringify(config)}),
  observation:id=>req(`/simulations/${id}/observation`),
  advance:(id,seconds=60)=>req(`/simulations/${id}/advance`,{method:"POST",body:JSON.stringify({seconds})}),
  order:(id,order)=>req(`/simulations/${id}/orders`,{method:"POST",body:JSON.stringify(order)}),
  account:id=>req(`/simulations/${id}/account`)
};
export default simulationClient;
