import {Argv, argv} from "yargs";
import {terminal} from "terminal-kit";
import {fakify} from "json-schema-fakify";
import * as jsf from "json-schema-faker";
import {asyncBulkMap, createDelay, logBulk} from "async-bulk-map";
import {CDP} from "./SDK/cdp";
import {Application, Event} from "./SDK/interfaces";
import {requestNumber, showMenu} from "./utils/terminal";
import {createArray, getFakers, getFields} from "./utils/schema";

export interface CliArgs {
    userKey: string,
    secret: string,
    bUnitId: string
}

const {userKey, secret, bUnitId} = argv as Argv<CliArgs>['argv'];

const sdk = new CDP({userKey, secret});

(async () => {

    const apps = await sdk.get<Application[]>(`/businessUnits/${bUnitId}/applications`);
    const selectedApp =
        await showMenu(`select application:`, apps, app => app.name);

    const events = await sdk.get<Event[]>(`/businessUnits/${bUnitId}/applications/${selectedApp.id}/events`);
    const selectedEvent =
        await showMenu(`select event:`, events, event => event.name);

    const fakified = fakify(selectedEvent.schema);
    const fields = getFields(fakified);

    let shouldEditSchema = true;
    while (shouldEditSchema) {
        fields.forEach(f => {
            terminal.white(f);
            terminal('\n');
        });

        terminal.cyan(`would you like to change fakers for schema fields? (y|N)`);
        shouldEditSchema = await terminal.yesOrNo({yes: 'y', no: ['n', 'ENTER']}).promise;

        if (shouldEditSchema) {
            const field = await showMenu(`select a field:`, fields);
            field.schema.faker = await showMenu(`select a faker:`, getFakers());
            terminal.green(`done: ${field.toString()}`)
        }
    }

    const quantity = await requestNumber(`number of events:`, 10);
    const batch = await requestNumber(`batch size:`, 50);

    const fakeEvents = createArray(quantity, () => jsf.generate(fakified));

    function ingest(event: object) {
        return sdk.post(
            `/businessUnits/${bUnitId}/applications/${selectedApp.id}/events/${selectedEvent.id}`,
            event).catch();
    }

    let ingestResponses: Array<{ errCode?: number }>;
    if (quantity >= batch) {
        ingestResponses = await Promise.all(fakeEvents.map(ingest));
    } else {
        const delay = await requestNumber(`batch delay ms:`, 1000);

        ingestResponses = await asyncBulkMap(fakeEvents, batch, {
            beforeBulk: logBulk,
            map: ingest,
            afterBulk: createDelay(delay)
        });
    }

    const failed = ingestResponses.filter(r => r.errCode != 0);

    if (!failed.length) {
        terminal.green(`all ingest requests passed successfully!`);
    } else {
        terminal.yellow(`${failed.length} failed out of ${ingestResponses.length} requests (${failed.length / ingestResponses.length * 100})`);
        terminal.white(`log failed? [Y|n]`);
        if (await terminal.yesOrNo({yes: ['y', 'ENTER'], no: 'n'}).promise) {
            terminal.white(failed);
        }
    }
})();
