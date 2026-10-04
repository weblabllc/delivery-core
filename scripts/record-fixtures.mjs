import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keyFile = process.env.NOVAPOSHTA_API_KEY_FILE;
if (!keyFile) {
    throw new Error('NOVAPOSHTA_API_KEY_FILE is required');
}
const apiKey = readFileSync(keyFile, 'utf8').trim();
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'novaposhta');
mkdirSync(outDir, { recursive: true });

const SYNTHETIC = {
        cityRef: '8d5a980d-391c-11dd-90d9-001a92567626',
    counterpartyRef: '11111111-1111-4111-8111-111111111111',
    contactRef: '22222222-2222-4222-8222-222222222222',
    recipientCounterpartyRef: '33333333-3333-4333-8333-333333333333',
    recipientContactRef: '44444444-4444-4444-8444-444444444444',
    documentRef: '55555555-5555-4555-8555-555555555555',
    documentNumber: '20450000000000',
    firstName: 'Тест',
    middleName: 'Тестович',
    lastName: 'Тестенко',
    fullName: 'Тестенко Тест Тестович',
    phone: '380501112233',
    email: 'test@example.com',
    edrpou: '00000000',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(modelName, calledMethod, methodProperties = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(600);
        const envelope = await callOnce(modelName, calledMethod, methodProperties);
        if (!envelope.errorCodes?.includes('20000401501')) {
            return envelope;
        }
    }
    throw new Error(`${modelName}.${calledMethod} is rate limited`);
}

async function callOnce(modelName, calledMethod, methodProperties) {
    const res = await fetch('https://api.novaposhta.ua/v2.0/json/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
        redirect: 'error',
    });
    return res.json();
}

const sensitive = new Set();
const collect = value => {
    if (typeof value === 'string' && value.length >= 4) {
        sensitive.add(value);
    }
};

function scrubCounterparty(item, refs) {
    for (const key of ['Ref', 'Description', 'FirstName', 'MiddleName', 'LastName', 'Counterparty', 'EDRPOU', 'Phones', 'Email']) {
        collect(item[key]);
    }
    const out = { ...item };
    if ('Ref' in out) out.Ref = refs.ref;
    if ('Counterparty' in out) out.Counterparty = refs.counterparty;
    if ('Description' in out) out.Description = SYNTHETIC.fullName;
    if ('FirstName' in out) out.FirstName = SYNTHETIC.firstName;
    if ('MiddleName' in out) out.MiddleName = SYNTHETIC.middleName;
    if ('LastName' in out) out.LastName = SYNTHETIC.lastName;
    if ('EDRPOU' in out) out.EDRPOU = SYNTHETIC.edrpou;
    if ('Phones' in out) out.Phones = SYNTHETIC.phone;
    if ('Email' in out) out.Email = SYNTHETIC.email;
        if ('City' in out) out.City = SYNTHETIC.cityRef;
    return out;
}

function scrubContacts(list, refs) {
    return list.map(item => scrubCounterparty(item, refs));
}

function scrubSavedRecipient(item) {
    const out = scrubCounterparty(item, { ref: SYNTHETIC.recipientCounterpartyRef, counterparty: SYNTHETIC.recipientCounterpartyRef });
    if (item.ContactPerson?.data) {
        out.ContactPerson = {
            ...item.ContactPerson,
            data: scrubContacts(item.ContactPerson.data, { ref: SYNTHETIC.recipientContactRef, counterparty: SYNTHETIC.recipientCounterpartyRef }),
        };
    }
    return out;
}

function save(name, envelope) {
    const text = JSON.stringify(envelope, null, 2) + '\n';
    for (const value of sensitive) {
        if (text.includes(value) && !Object.values(SYNTHETIC).includes(value)) {
            throw new Error(`fixture ${name} still contains a sensitive value`);
        }
    }
    if (text.includes(apiKey)) {
        throw new Error(`fixture ${name} contains the api key`);
    }
    writeFileSync(join(outDir, `${name}.json`), text);
}

async function main() {
    const settlements = await call('AddressGeneral', 'searchSettlements', { CityName: 'київ', Limit: '3', Page: '1' });
    save('search-settlements-kyiv', settlements);
    const kyivCityRef = settlements.data[0].Addresses[0].DeliveryCity;

    const types = await call('AddressGeneral', 'getWarehouseTypes');
    save('warehouse-types', types);
    const postomatType = types.data.find(t => t.Description === 'Поштомат')?.Ref;

    save('warehouses-kyiv', await call('AddressGeneral', 'getWarehouses', { CityRef: kyivCityRef, Page: '1', Limit: '3' }));
    if (postomatType) {
        save('postomats-kyiv', await call('AddressGeneral', 'getWarehouses', { CityRef: kyivCityRef, TypeOfWarehouseRef: postomatType, Page: '1', Limit: '2' }));
    }

    const lviv = await call('AddressGeneral', 'searchSettlements', { CityName: 'львів', Limit: '1', Page: '1' });
    const lvivCityRef = lviv.data[0].Addresses[0].DeliveryCity;
    save(
        'document-price-kyiv-lviv',
        await call('InternetDocumentGeneral', 'getDocumentPrice', {
            CitySender: kyivCityRef,
            CityRecipient: lvivCityRef,
            Weight: '1',
            ServiceType: 'WarehouseWarehouse',
            Cost: '500',
            CargoType: 'Cargo',
            SeatsAmount: '1',
        }),
    );

    const counterparties = await call('CounterpartyGeneral', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' });
    const senderRef = counterparties.data[0].Ref;
    const contacts = await call('CounterpartyGeneral', 'getCounterpartyContactPersons', { Ref: senderRef, Page: '1' });
    save('sender-counterparties', { ...counterparties, data: scrubContacts(counterparties.data, { ref: SYNTHETIC.counterpartyRef, counterparty: SYNTHETIC.counterpartyRef }) });
    save('contact-persons', { ...contacts, data: scrubContacts(contacts.data, { ref: SYNTHETIC.contactRef, counterparty: SYNTHETIC.counterpartyRef }) });

    save('tracking-not-found', await call('TrackingDocumentGeneral', 'getStatusDocuments', { Documents: [{ DocumentNumber: '20400000000000' }] }));

    if (process.env.NOVAPOSHTA_RECORD_WAYBILL === '1') {
        const { NovaPoshtaCarrier } = await import('../dist/novaposhta.js');
        const captured = [];
        const capturingFetch = async (url, init) => {
            const res = await fetch(url, init);
            const text = await res.clone().text();
            captured.push({ method: JSON.parse(init.body).calledMethod, text });
            return res;
        };
        const carrier = new NovaPoshtaCarrier({ apiKey, fetch: capturingFetch, maxRetries: 5 });
        const lastOf = method => JSON.parse(captured.findLast(c => c.method === method).text);

        const [counterparty] = await carrier.getSenderCounterparties();
        const [contact] = await carrier.getContactPersons(counterparty.ref);
        const kyivWarehouse = (await carrier.getWarehouses({ cityRef: kyivCityRef, page: 1, limit: 20 })).find(w => w.kind === 'warehouse' && !w.denyToSelect);
        const lvivWarehouse = (await carrier.getWarehouses({ cityRef: lvivCityRef, page: 1, limit: 20 })).find(w => w.kind === 'warehouse' && !w.denyToSelect);
        const postomat = (await carrier.getWarehouses({ cityRef: kyivCityRef, typeRef: postomatType, page: 1, limit: 20 })).find(w => !w.denyToSelect);

        const recipient = await carrier.createPrivateRecipient({
            firstName: SYNTHETIC.firstName,
            middleName: SYNTHETIC.middleName,
            lastName: SYNTHETIC.lastName,
            phone: SYNTHETIC.phone,
            email: SYNTHETIC.email,
        });
        const recipientEnvelope = lastOf('save');
        save('counterparty-save-recipient', { ...recipientEnvelope, data: recipientEnvelope.data.map(scrubSavedRecipient) });

        const sender = {
            cityRef: kyivCityRef,
            counterpartyRef: counterparty.ref,
            addressRef: kyivWarehouse.ref,
            contactRef: contact.ref,
            phone: contact.phones[0],
        };
        const base = {
            payerType: 'Recipient',
            paymentMethod: 'Cash',
            serviceType: 'WarehouseWarehouse',
            seatsAmount: 1,
            description: 'Тестове відправлення',
            declaredValueMinor: 30000,
            sender,
        };
        const refs = [];
        try {
            const toWarehouse = await carrier.createWaybill({
                ...base,
                cargoType: 'Cargo',
                weightGrams: 500,
                recipient: { cityRef: lvivCityRef, counterpartyRef: recipient.counterpartyRef, addressRef: lvivWarehouse.ref, contactRef: recipient.contactRef, phone: SYNTHETIC.phone, pointKind: 'warehouse' },
            });
            refs.push(toWarehouse.ref);
            const saved = lastOf('save');
            save('internet-document-save', { ...saved, data: saved.data.map(d => ({ ...d, Ref: SYNTHETIC.documentRef, IntDocNumber: SYNTHETIC.documentNumber })) });

            const toPostomat = await carrier.createWaybill({
                ...base,
                cargoType: 'Parcel',
                weightGrams: 1000,
                optionsSeat: [{ weightGrams: 1000, widthCm: 20, lengthCm: 30, heightCm: 10 }],
                recipient: { cityRef: kyivCityRef, counterpartyRef: recipient.counterpartyRef, addressRef: postomat.ref, contactRef: recipient.contactRef, phone: SYNTHETIC.phone, pointKind: 'postomat' },
            });
            refs.push(toPostomat.ref);
            const savedPostomat = lastOf('save');
            save('internet-document-save-postomat', { ...savedPostomat, data: savedPostomat.data.map(d => ({ ...d, Ref: SYNTHETIC.documentRef, IntDocNumber: SYNTHETIC.documentNumber })) });
        } finally {
            for (const ref of refs) {
                await carrier.deleteWaybill(ref);
            }
            if (refs.length) {
                const deleted = lastOf('delete');
                save('internet-document-delete', { ...deleted, data: deleted.data.map(d => ({ ...d, Ref: SYNTHETIC.documentRef })) });
            }
        }

        save('internet-document-save-error', await call('InternetDocumentGeneral', 'save', { PayerType: 'Recipient', CitySender: 'bad' }));
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : 'failed');
    process.exitCode = 1;
});
