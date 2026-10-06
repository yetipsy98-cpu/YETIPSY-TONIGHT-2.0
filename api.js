window.YT_API = (()=>{
  const API_URL = 'https://script.google.com/macros/s/AKfycby4cZXXCMlZBTcuPzuShHq2K3zUUXxlL6MAb_-Et_6uKX-gO8WCgbcyHnWvsfQQBn7Jpg/exec';
  const TIMEOUT = 12000;
  const configured = () => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_URL);
  async function post(action,data={}){
    if(!configured()) return {ok:false,error:'backend_not_configured'};
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT);
    try{
      const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...data}),signal:controller.signal});
      const text=await r.text();
      try{return JSON.parse(text)}catch{return{ok:false,error:'invalid_backend_response',raw:text.slice(0,180)}}
    }catch(e){return{ok:false,error:e.name==='AbortError'?'timeout':'network_error',detail:String(e)}}finally{clearTimeout(timer)}
  }
  return {configured,post};
})();
