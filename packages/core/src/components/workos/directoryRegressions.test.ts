/**
 * Interleavings of WorkOS changes, syncs and faults that once left the copy
 * different from WorkOS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copy,
  expected,
  type Op,
  OPS,
  play,
  replica,
} from "../workosTestSetup.ts";

afterEach(() => {
  vi.useRealTimers();
});

function steps(trace: string): [Op, number][] {
  return trace.split(" ").map((item) => {
    const [op, n] = item.split(":");
    const found = OPS.find((name) => name === op);
    if (found === undefined) throw new Error(`no op ${String(op)}`);
    return [found, Number(n)];
  });
}

// Interleavings that once broke the copy, kept as fixed cases.
describe("regressions", () => {
  it("tombstones a directory user whose directory the mirror never held when its organization goes", async () => {
    const { t, fake } = await play(
      1,
      false,
      steps("sync:0 advance:0 directoryUser:0 deleteOrganization:0"),
    );
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("keeps a stale organization event from bringing back a domain a newer snapshot dropped", async () => {
    const trace =
      "sync:16 directoryUser:38 domains:15 domains:34 deactivate:6 user:43 deactivate:26 settle:45 sync:11 sync:20 directory:19 deleteDirectory:36 deactivate:24 deleteDirectory:6 deleteDirectoryUser:50 deleteDirectoryUser:4 deleteDirectoryUser:32 suspend:14 deleteUser:43 domains:12 deleteMembership:47 organization:36 rename:47 sync:25 directoryUser:37 updateMembership:31 domains:4 deleteOrganization:42 add:34 transient:43 deleteOrganization:22 rename:48 deactivate:25 write:27";
    const { t, fake } = await play(3, false, steps(trace), 25);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("tombstones an edge streamed for a group and user the mirror never held once the directory goes", async () => {
    const trace = `write:0 organization:0 settle:0 add:0 ${"organization:0 ".repeat(20)}deleteDirectory:0`;
    const { t, fake } = await play(1, false, steps(trace), 0);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("sweeps rows of an organization deleted while the cursor was expired and never mirrored", async () => {
    const trace =
      "expire:19 write:23 deleteGroup:29 deleteDirectoryUser:29 deleteOrganization:27 directoryUser:1 remove:44 expire:50 user:32 deleteOrganization:11 renameUser:7 domains:33 renameUser:13 deleteDomain:6 deactivate:1 deleteDirectory:37 group:4 addDomain:50 organization:10 deleteGroup:16 addDomain:42 domains:0 remove:7 deleteConnection:37 membership:2 deleteGroup:48 group:44 deleteDirectory:25 advance:43 failDomain:42 transient:43 connection:4 deleteUser:15";
    const { t, fake } = await play(1, false, steps(trace), 7);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });

  it("lists after a restart only once the stream has read past the new boundary", async () => {
    const trace =
      "organization:0 membership:0 deleteOrganization:0 directory:0 rename:0 deleteConnection:0 deleteGroup:0 settle:0 renameGroup:0 domains:0 add:0 directoryUser:0 rename:0 deleteDirectory:0 expire:0 deleteDomain:0 group:0 deleteConnection:0 sync:0 addDomain:0 organization:0 domains:0";
    const { t, fake } = await play(1, true, steps(trace), 0);
    expect(await copy(t)).toEqual(fake.snapshot());
    expect(await replica(t)).toEqual(expected(fake));
  });
});
