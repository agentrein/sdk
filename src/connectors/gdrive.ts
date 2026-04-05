import { google } from 'googleapis';
import { ConnectorAction } from '../agentreinClient';

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    [key: string]: unknown;
}

export interface DriveFileCreateArgs {
    name: string;
    mimeType: string;
    parents?: string[];
    content?: string;
}

export interface DriveFileUpdateArgs {
    id: string;
    name?: string;
    mimeType?: string;
    [key: string]: unknown;
}

export interface DriveFileMoveArgs {
    fileId: string;
    addParents: string;
    removeParents: string;
}

export interface DriveFileTrashArgs {
    fileId: string;
}

export function getDriveClient() {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    return google.drive({ version: 'v3', auth });
}

export const gdriveFilesCreate: ConnectorAction<DriveFileCreateArgs, DriveFile> = {
    apiName: 'gdrive.files.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    execute: async (args) => {
        const drive = getDriveClient();
        const requestBody: any = {
            name: args.name,
            mimeType: args.mimeType,
        };
        if (args.parents) requestBody.parents = args.parents;

        const params: any = {
            requestBody,
            fields: 'id, name, mimeType, parents',
        };

        if (args.content) {
            params.media = {
                mimeType: args.mimeType,
                body: args.content,
            };
        }

        const res = await drive.files.create(params);
        return res.data as DriveFile;
    }
};

export const gdriveFilesUpdate: ConnectorAction<DriveFileUpdateArgs, DriveFile> = {
    apiName: 'gdrive.files.update',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: (apiName: string, payload: any) => `https://www.googleapis.com/drive/v3/files/${payload.id}`,
    getState: async (args: DriveFileUpdateArgs) => {
        const res = await getDriveClient().files.get({
            fileId: args.id,
            fields: 'id, name, mimeType, parents',
        });
        return res.data;
    },
    execute: async (args) => {
        const drive = getDriveClient();
        const { id, ...requestBody } = args;
        const res = await drive.files.update({
            fileId: id,
            requestBody,
            fields: 'id, name, mimeType, parents',
        });
        return res.data as DriveFile;
    }
};

export const gdriveFilesMove: ConnectorAction<DriveFileMoveArgs, DriveFile> = {
    apiName: 'gdrive.files.move',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: (apiName: string, payload: any) => `https://www.googleapis.com/drive/v3/files/${payload.fileId}`,
    getState: async (args: DriveFileMoveArgs) => {
        const res = await getDriveClient().files.get({
            fileId: args.fileId,
            fields: 'id, name, mimeType, parents',
        });
        return res.data;
    },
    execute: async (args) => {
        const drive = getDriveClient();
        const res = await drive.files.update({
            fileId: args.fileId,
            addParents: args.addParents,
            removeParents: args.removeParents,
            fields: 'id, name, mimeType, parents',
        });
        return res.data as DriveFile;
    }
};

export const gdriveFilesTrash: ConnectorAction<DriveFileTrashArgs, DriveFile> = {
    apiName: 'gdrive.files.trash',
    operationType: 'UPDATE',
    // @ts-ignore
    resourceUrlResolver: () => null,
    getState: async (args: DriveFileTrashArgs) => {
        const res = await getDriveClient().files.get({
            fileId: args.fileId,
            fields: 'id, name, mimeType, parents, trashed',
        });
        return res.data;
    },
    execute: async (args) => {
        const drive = getDriveClient();
        const res = await drive.files.update({
            fileId: args.fileId,
            requestBody: { trashed: true },
            fields: 'id, name, mimeType, parents, trashed',
        });
        return res.data as DriveFile;
    }
};
