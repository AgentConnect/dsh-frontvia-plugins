/** Customer business projection; protocol state and credentials stay in public PAP. */
export interface BusinessSite {
  id:string;label:string;domain:string;issuer:string;resource:string;
  description?:{methods:string[];profile?:string};service?:{store_id?:string};
}
export interface PapPort {
  readonly apiVersion:number;
  sites():BusinessSite[];
  status(ref?:string):any[];
  connect(domain:string):Promise<{connectionRef:string}>;
  identity(ref:string):{issuer:string;resource:string;signedIn:boolean;clientId?:string;userId?:string};
  request(ref:string,method:string,params:unknown,signal?:AbortSignal,options?:{maxResponseBytes:number}):Promise<any>;
  canAccess?(ref:string):boolean;
  /** Chat ownership is independent of whether a particular remote session is connected. */
  isCurrentIdentity?(ref:string):boolean;
  capabilityCacheKey?(ref:string):string;
  prepareDomain?(domain:string):Promise<void>;
  refresh?():Promise<void>;
  hostedPayment?(ref:string,link:string,checkoutId:string):Promise<any>;
}
