import Stripe from 'stripe';
import type { ConnectorAction } from '../agentreinClient';
type ResourceUrlResolver = any;

// ─── Client (lazy singleton) ────────────────────────────

let _client: Stripe | null = null;

function client(): Stripe {
    if (!_client) {
        if (!process.env.STRIPE_KEY) throw new Error('STRIPE_KEY not set');
        _client = new Stripe(process.env.STRIPE_KEY);
    }
    return _client;
}

// ─── Resource URL Resolvers ─────────────────────────────

const STRIPE_API = 'https://api.stripe.com/v1';

const invoiceUrlResolver: ResourceUrlResolver = (_apiName: string, payload: any) => {
    const id = payload.id as string | undefined;
    return id ? `${STRIPE_API}/invoices/${id}` : null;
};

const customerUrlResolver: ResourceUrlResolver = (_apiName: string, payload: any) => {
    const id = payload.id as string | undefined;
    return id ? `${STRIPE_API}/customers/${id}` : null;
};

// ─── Typed Actions ──────────────────────────────────────

const invoicesCreate: ConnectorAction<
    Stripe.InvoiceCreateParams,
    Stripe.Invoice
> = {
    apiName: 'stripe.invoices.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: invoiceUrlResolver,
    execute: (args) => client().invoices.create(args),
};

const invoicesDel: ConnectorAction<string, Stripe.DeletedInvoice> = {
    apiName: 'stripe.invoices.del',
    operationType: 'DELETE',
    // @ts-ignore
    resourceUrlResolver: invoiceUrlResolver,
    execute: (id) => client().invoices.del(id),
};

const customersCreate: ConnectorAction<
    Stripe.CustomerCreateParams,
    Stripe.Customer
> = {
    apiName: 'stripe.customers.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: customerUrlResolver,
    execute: (args) => client().customers.create(args),
};

const customersDel: ConnectorAction<string, Stripe.DeletedCustomer> = {
    apiName: 'stripe.customers.del',
    operationType: 'DELETE',
    // @ts-ignore
    resourceUrlResolver: customerUrlResolver,
    execute: (id) => client().customers.del(id),
};

const refundsCreate: ConnectorAction<
    Stripe.RefundCreateParams,
    Stripe.Refund
> = {
    apiName: 'stripe.refunds.create',
    operationType: 'CREATE',
    // @ts-ignore
    resourceUrlResolver: () => null, // refunds have no GET-fetchable state
    execute: (args) => client().refunds.create(args),
};

// ─── Export ─────────────────────────────────────────────

export const stripe = {
    invoices: {
        create: invoicesCreate,
        del: invoicesDel,
    },
    customers: {
        create: customersCreate,
        del: customersDel,
    },
    refunds: {
        create: refundsCreate,
    },
} as const;
