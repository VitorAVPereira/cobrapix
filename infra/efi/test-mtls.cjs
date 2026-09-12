'use strict';
// Local trust-boundary test only. It cannot simulate possession of Efí's private key.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const forge = require('../../api-cobranca/node_modules/node-forge');
const root = path.resolve(__dirname,'../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ciframais-mtls-'));
const suffix = randomBytes(5).toString('hex');
const network = 'efi-mtls-'+suffix;
const api = network+'-api';
const nginx = network+'-nginx';
function docker(args, required = true) {
  const result = spawnSync('docker',args,{encoding:'utf8',timeout:180000});
  if(required && result.status!==0) throw new Error('Docker '+args[0]+' failed: '+result.stderr);
  return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim();
}
function certificate(name,issuer,isCA=false) {
  const keys=forge.pki.rsa.generateKeyPair(2048), cert=forge.pki.createCertificate();
  cert.publicKey=keys.publicKey; cert.serialNumber='01'+randomBytes(15).toString('hex');
  cert.validity.notBefore=new Date(Date.now()-3600000); cert.validity.notAfter=new Date(Date.now()+86400000);
  cert.setSubject([{name:'commonName',value:name}]); cert.setIssuer(issuer?issuer.cert.subject.attributes:cert.subject.attributes);
  cert.setExtensions([{name:'basicConstraints',cA:isCA},{name:'keyUsage',digitalSignature:true,keyEncipherment:true,keyCertSign:isCA},...(isCA?[]:[{name:'extKeyUsage',serverAuth:true,clientAuth:true},{name:'subjectAltName',altNames:[{type:2,value:name}]}])]);
  cert.sign(issuer?issuer.keys.privateKey:keys.privateKey,forge.md.sha256.create());
  return {cert,keys,pem:forge.pki.certificateToPem(cert),key:forge.pki.privateKeyToPem(keys.privateKey)};
}
function request(port,hostname,client,route,spoof=false) {
  return new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port,servername:hostname,path:route,method:'POST',ca:ca.pem,key:client?.key,cert:client?.pem,headers:{Host:hostname,'Content-Type':'application/json',...(spoof?{'X-Efi-Client-Verify':'SUCCESS'}:{})},timeout:5000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Request timeout')));req.end('{}');
  });
}
const ca=certificate('Local test trust authority',null,true);
const server=certificate('efi-webhooks.ciframais.example',ca);
const publicServer=certificate('api.ciframais.example',ca);
const good=certificate('Efi simulation - test only',ca);
const bad=certificate('untrusted',certificate('untrusted CA',null,true));
(async()=>{
  try {
    for(const [name,value] of Object.entries({'efi-fullchain.pem':server.pem,'efi-key.pem':server.key,'api-fullchain.pem':publicServer.pem,'api-key.pem':publicServer.key,'efi-client-ca.pem':ca.pem}))fs.writeFileSync(path.join(temp,name),value);
    docker(['network','create','--subnet','172.29.43.0/24',network]);
    docker(['run','-d','--name',api,'--network',network,'--network-alias','api','-e','EFI_MTLS_PROXY_IP=172.29.43.10','-v',path.join(__dirname,'mtls-test-app.cjs')+':/app/mtls-test-app.cjs:ro','ciframais-efi-local:verification','node','mtls-test-app.cjs']);
    docker(['run','-d','--name',nginx,'--network',network,'--ip','172.29.43.10','-p','127.0.0.1::443','-v',path.join(__dirname,'nginx.conf')+':/etc/nginx/nginx.conf:ro','-v',temp+':/etc/nginx/tls:ro','nginx:stable-alpine']);
    const port=Number(docker(['port',nginx,'443/tcp']).split(':').at(-1));
    let ready=false; let lastProbe='none';
    for(let i=0;i<30;i++){try{lastProbe=await request(port,'efi-webhooks.ciframais.example',good,'/webhooks/efi/account-opening');if(lastProbe===201){ready=true;break;}}catch(error){lastProbe=error.message;} await new Promise(r=>setTimeout(r,1000));}
    if(!ready)throw new Error('Test application did not start ('+lastProbe+'): '+docker(['logs',api],false)+' nginx: '+docker(['logs',nginx],false));
    const cases=[
      ['missing certificate','efi-webhooks.ciframais.example',null,'/webhooks/efi/account-opening',false,400],
      ['untrusted certificate','efi-webhooks.ciframais.example',bad,'/webhooks/efi/account-opening',false,400],
      ['trusted certificate reaches Nest guard','efi-webhooks.ciframais.example',good,'/webhooks/efi/account-opening',false,201],
      ['trusted Pix callback','efi-webhooks.ciframais.example',good,'/webhooks/efi/pix',false,201],
      ['spoofed proxy header on public host','api.ciframais.example',null,'/webhooks/efi/account-opening',true,403],
      ['dedicated host rejects other routes','efi-webhooks.ciframais.example',good,'/payments/create',false,404],
    ];
    for(const [label,host,client,route,spoof,expected] of cases){const actual=await request(port,host,client,route,spoof);if(actual!==expected)throw new Error(label+': '+actual+' != '+expected);console.log('PASS '+label);}
  } finally {
    docker(['rm','-f',nginx,api],false);docker(['network','rm',network],false);
    const resolved=path.resolve(temp);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('ciframais-mtls-'))fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
