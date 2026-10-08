import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOAuthProvider } from '../src/oauth.js'

it('ungranted client registrations cannot permanently exhaust the client limit',()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'gym-oauth-lifecycle-'))
  try {
    const issuer=new URL('https://gym.example'), resource=new URL('/mcp',issuer)
    const redirect='https://chatgpt.com/connector_platform_oauth_redirect'
    const p=createOAuthProvider({data,issuer,resource,redirectUris:[redirect],readSession:()=>null,userById:()=>null})
    for(let i=0;i<110;i++) p.clientsStore.registerClient({redirect_uris:[redirect],token_endpoint_auth_method:'none'})
    const saved=JSON.parse(fs.readFileSync(path.join(data,'mcp-oauth.json')))
    expect(Object.keys(saved.clients)).toHaveLength(100)
  } finally {fs.rmSync(data,{recursive:true})}
})
