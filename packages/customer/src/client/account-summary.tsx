import React from 'react';
import {Button} from './ui.js';
export type AccountStatus={configured:boolean;provider?:string;state?:string};
export function AccountSummary({status,error,openAccount}:{status?:AccountStatus;error:boolean;openAccount:()=>void}){
 const label=error?'暂时无法核对公共身份':!status?'正在读取公共身份状态…':status.configured?'已通过公共身份接入':status.state==='unconfigured'?'在对话中提供店铺域名即可开始接入':'请在公共身份/PAP 设置中核对身份及授权';
 return <div className="fv-account-summary" aria-label="公共身份状态"><p role="status">{label}</p><Button variant="ghost" size="sm" onClick={openAccount}>公共身份与 PAP 设置</Button></div>;
}
