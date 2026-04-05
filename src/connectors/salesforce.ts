import axios from 'axios';
import { ConnectorAction } from '../agentreinClient';

export interface SalesforceContact {
  id: string;
  fields: Record<string, unknown>;
}

export interface SalesforceOpportunity {
  id: string;
  fields: Record<string, unknown>;
}

export interface SalesforceCreateArgs {
  fields: Record<string, unknown>;
}

export interface SalesforceUpdateArgs {
  id: string;
  fields: Record<string, unknown>;
}

export function getSalesforceAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.SALESFORCE_ACCESS_TOKEN ?? ''}` };
}

export function getSalesforceBaseUrl(): string {
  return `${process.env.SALESFORCE_INSTANCE_URL ?? ''}/services/data/v58.0/sobjects`;
}

export const salesforceContactsCreate: ConnectorAction<SalesforceCreateArgs, SalesforceContact> = {
    apiName: 'salesforce.contacts.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await axios.post(`${getSalesforceBaseUrl()}/Contact`, args.fields, {
            headers: getSalesforceAuthHeader()
        });
        return { id: res.data.id, fields: args.fields };
    }
};

export const salesforceContactsUpdate: ConnectorAction<SalesforceUpdateArgs, SalesforceContact> = {
    apiName: 'salesforce.contacts.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: (apiName: string, payload: any) => `${getSalesforceBaseUrl()}/Contact/${payload.id}`,
    getState: async (args: SalesforceUpdateArgs) => {
        const res = await axios.get(
            `${getSalesforceBaseUrl()}/Contact/${args.id}`,
            { headers: getSalesforceAuthHeader() }
        );
        return { id: args.id, fields: res.data };
    },
    execute: async (args) => {
        await axios.patch(`${getSalesforceBaseUrl()}/Contact/${args.id}`, args.fields, {
            headers: getSalesforceAuthHeader()
        });
        return { id: args.id, fields: args.fields };
    }
};

export const salesforceOpportunitiesCreate: ConnectorAction<SalesforceCreateArgs, SalesforceOpportunity> = {
    apiName: 'salesforce.opportunities.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const res = await axios.post(`${getSalesforceBaseUrl()}/Opportunity`, args.fields, {
            headers: getSalesforceAuthHeader()
        });
        return { id: res.data.id, fields: args.fields };
    }
};

export const salesforceOpportunitiesUpdate: ConnectorAction<SalesforceUpdateArgs, SalesforceOpportunity> = {
    apiName: 'salesforce.opportunities.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: (apiName: string, payload: any) => `${getSalesforceBaseUrl()}/Opportunity/${payload.id}`,
    getState: async (args: SalesforceUpdateArgs) => {
        const res = await axios.get(
            `${getSalesforceBaseUrl()}/Opportunity/${args.id}`,
            { headers: getSalesforceAuthHeader() }
        );
        return { id: args.id, fields: res.data };
    },
    execute: async (args) => {
        await axios.patch(`${getSalesforceBaseUrl()}/Opportunity/${args.id}`, args.fields, {
            headers: getSalesforceAuthHeader()
        });
        return { id: args.id, fields: args.fields };
    }
};
