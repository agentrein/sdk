import axios from 'axios';
import { ConnectorAction } from '../agentreinClient'; // Assuming this is how it's typed based on the codebase

export interface HubSpotContact {
  id: string;
  properties: Record<string, string>;
}

export interface HubSpotDeal {
  id: string;
  properties: Record<string, string>;
}

export interface HubSpotCreateArgs {
  properties: Record<string, string>;
}

export interface HubSpotUpdateArgs {
  id: string;
  properties: Record<string, string>;
}

export function getHubSpotAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN ?? ''}` };
}

export const hubspotContactsCreate: ConnectorAction<HubSpotCreateArgs, HubSpotContact> = {
  apiName: 'hubspot.contacts.create',
  operationType: 'CREATE' as const,
  // @ts-ignore
  resourceUrlResolver: () => null,
  execute: async (args: HubSpotCreateArgs): Promise<HubSpotContact> => {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      { properties: args.properties },
      { headers: getHubSpotAuthHeader() }
    );
    return response.data as HubSpotContact;
  }
};

export const hubspotContactsUpdate: ConnectorAction<HubSpotUpdateArgs, HubSpotContact> = {
  apiName: 'hubspot.contacts.update',
  operationType: 'UPDATE' as const,
  // @ts-ignore
  resourceUrlResolver: (apiName: string, payload: { id: string }) => 
    `https://api.hubapi.com/crm/v3/objects/contacts/${payload.id}`,
  getState: async (args: HubSpotUpdateArgs) => {
    const res = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/contacts/${args.id}`,
        { headers: getHubSpotAuthHeader() }
    );
    return res.data;
  },
  execute: async (args: HubSpotUpdateArgs): Promise<HubSpotContact> => {
    const response = await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${args.id}`,
      { properties: args.properties },
      { headers: getHubSpotAuthHeader() }
    );
    return response.data as HubSpotContact;
  }
};

export const hubspotDealsCreate: ConnectorAction<HubSpotCreateArgs, HubSpotDeal> = {
  apiName: 'hubspot.deals.create',
  operationType: 'CREATE' as const,
  // @ts-ignore
  resourceUrlResolver: () => null,
  execute: async (args: HubSpotCreateArgs): Promise<HubSpotDeal> => {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/deals',
      { properties: args.properties },
      { headers: getHubSpotAuthHeader() }
    );
    return response.data as HubSpotDeal;
  }
};

export const hubspotDealsUpdate: ConnectorAction<HubSpotUpdateArgs, HubSpotDeal> = {
  apiName: 'hubspot.deals.update',
  operationType: 'UPDATE' as const,
  // @ts-ignore
  resourceUrlResolver: (apiName: string, payload: { id: string }) => 
    `https://api.hubapi.com/crm/v3/objects/deals/${payload.id}`,
  getState: async (args: HubSpotUpdateArgs) => {
    const res = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/deals/${args.id}`,
        { headers: getHubSpotAuthHeader() }
    );
    return res.data;
  },
  execute: async (args: HubSpotUpdateArgs): Promise<HubSpotDeal> => {
    const response = await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/deals/${args.id}`,
      { properties: args.properties },
      { headers: getHubSpotAuthHeader() }
    );
    return response.data as HubSpotDeal;
  }
};
