import { google } from 'googleapis';
import { ConnectorAction } from '../agentreinClient';

export interface SheetsSpreadsheet {
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheets?: SheetsSheet[];
}

export interface SheetsSheet {
    properties: {
        sheetId: number;
        title: string;
        index: number;
    };
}

export interface SheetsValuesAppendArgs {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
}

export interface SheetsValuesUpdateArgs {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
}

export interface SheetsSpreadsheetCreateArgs {
    title: string;
    sheets?: { title: string }[];
}

export interface SheetAddArgs {
    spreadsheetId: string;
    title: string;
}

export interface SheetsValuesBeforeState {
    spreadsheetId: string;
    range: string;
    values: unknown[][];
}

export function getSheetsClient() {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    return google.sheets({ version: 'v4', auth });
}

export function getDriveClientForSheets() {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    return google.drive({ version: 'v3', auth });
}

export const gsheetsValuesAppend: ConnectorAction<SheetsValuesAppendArgs, any> = {
    apiName: 'gsheets.values.append',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const sheets = getSheetsClient();
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            valueInputOption: 'RAW',
            requestBody: { values: args.values },
        });
        return res.data;
    }
};

export const gsheetsValuesUpdate: ConnectorAction<SheetsValuesUpdateArgs, any> = {
    apiName: 'gsheets.values.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    getState: async (args: SheetsValuesUpdateArgs) => {
        const res = await getSheetsClient().spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
        });
        return {
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            values: res.data.values ?? [],
        };
    },
    execute: async (args) => {
        const sheets = getSheetsClient();
        const res = await sheets.spreadsheets.values.update({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            valueInputOption: 'RAW',
            requestBody: { values: args.values },
        });
        return res.data;
    }
};

export const gsheetsSpreadsheetsCreate: ConnectorAction<SheetsSpreadsheetCreateArgs, SheetsSpreadsheet> = {
    apiName: 'gsheets.spreadsheets.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const sheets = getSheetsClient();
        const requestBody: any = { properties: { title: args.title } };
        if (args.sheets) {
            requestBody.sheets = args.sheets.map(s => ({ properties: { title: s.title } }));
        }
        const res = await sheets.spreadsheets.create({
            requestBody,
        });
        return res.data as SheetsSpreadsheet;
    }
};

export const gsheetsSheetsAdd: ConnectorAction<SheetAddArgs, any> = {
    apiName: 'gsheets.sheets.add',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const sheets = getSheetsClient();
        const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
                requests: [
                    { addSheet: { properties: { title: args.title } } }
                ]
            }
        });
        return res.data;
    }
};
