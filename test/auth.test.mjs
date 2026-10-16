import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createTokenVerifier, issuer, resourceUrl } from '../dist/auth.js';
import { createApp } from '../dist/app.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const {privateKey,publicKey}=await generateKeyPair('RS256');
const verifier=createTokenVerifier(createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]}));
async function token(claims={}) {
 return new SignJWT({scope:'access:mcp',...claims}).setProtectedHeader({alg:'RS256',kid:'test'})
 .setIssuer(issuer).setAudience(resourceUrl).setSubject('auth0|customer').setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
test('valid tokens preserve email and the real verification boolean',async()=>{
 for(const value of [true,false,'true',undefined]) {
  const checked=await verifier(await token({[resourceUrl+'/email']:'customer@example.com',[resourceUrl+'/email_verified']:value}));
  assert.equal(checked.ok,true);
  assert.equal(checked.authInfo.extra.email,'customer@example.com');
  assert.equal(checked.authInfo.extra.email_verified,value===true);
  assert.equal(checked.authInfo.extra.sub,'auth0|customer');
 }
 const absent=await verifier(await token());
 assert.equal(absent.authInfo.extra.email,undefined);
 assert.equal(absent.authInfo.extra.email_verified,false);
});
test('reject invalid signatures, expiry, issuer, audience, missing expiry and missing scope',async()=>{
 const sign=(claims)=>new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);
 for(const claims of [
  {iss:'https://wrong.example/',aud:resourceUrl,sub:'user',iat:1,exp:9999999999,scope:'access:mcp'},
  {iss:issuer,aud:'wrong',sub:'user',iat:1,exp:9999999999,scope:'access:mcp'},
  {iss:issuer,aud:resourceUrl,sub:'user',iat:1,exp:1,scope:'access:mcp'},
  {iss:issuer,aud:resourceUrl,sub:'user',iat:1,scope:'access:mcp'},
 ]) assert.equal((await verifier(await sign(claims))).ok,false);
 assert.equal((await verifier(await token({scope:'read:companies'}))).reason,'insufficient_scope');
 const bad=await token();const parts=bad.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
 assert.equal((await verifier(parts.join('.'))).ok,false);
});
test('HTTP auth protects every method and passes identity to MCP handlers',async()=>{
 const app=createApp({verifyToken:verifier,serverFactory:()=>{
  const server=new McpServer({name:'identity-test',version:'1'});
  server.registerTool('identity',{inputSchema:{}},async (_args,extra)=>({content:[{type:'text',text:JSON.stringify(extra.authInfo?.extra)}]}));
  return {server};
 }});
 const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
 const url=`http://127.0.0.1:${listener.address().port}/mcp`;
 const access=await token({[resourceUrl+'/email']:'customer@example.com',[resourceUrl+'/email_verified']:true});
 const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{authorization:`Bearer ${access}`}}});
 const client=new Client({name:'test',version:'1'});
 try {
  for(const method of ['POST','GET','DELETE']) {
   const r=await fetch(url,{method});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/resource_metadata/);
  }
  const missingScope=await fetch(url,{headers:{authorization:`Bearer ${await token({scope:''})}`}});assert.equal(missingScope.status,403);
  await client.connect(transport);
  const identity=JSON.parse((await client.callTool({name:'identity',arguments:{}})).content[0].text);
  assert.equal(identity.email,'customer@example.com');assert.equal(identity.email_verified,true);
  const other=new SignJWT({scope:'access:mcp'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(resourceUrl).setSubject('other').setIssuedAt().setExpirationTime('5m');
  const cross=await fetch(url,{method:'DELETE',headers:{authorization:`Bearer ${await other.sign(privateKey)}`,'mcp-session-id':transport.sessionId}});
  assert.equal(cross.status,403);
 } finally {await transport.terminateSession();await client.close();await new Promise(r=>listener.close(r));}
});
