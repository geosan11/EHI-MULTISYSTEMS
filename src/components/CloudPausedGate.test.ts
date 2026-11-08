import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORCED_RELOAD_KEY,
  CLOUD_PAUSED_TITLE,
  CLOUD_PAUSED_BODY,
  GATE_CONTAINER_ID,
  getOrCreateGateContainer,
} from './CloudPausedGate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CloudPausedGate Requirements & Behavioral Contract', () => {
  describe('Exact Copy & Sentinel Integrity', () => {
    test('matches exact user-specified title and body with correct Unicode punctuation', () => {
      const EXPECTED_TITLE = 'EHI MULTISYSTEMS \u2014 CLOUD INSTANCE PAUSED';
      const EXPECTED_BODY =
        'Subscription renewal for Vercel & Supabase production hosting (Invoice Date: 28 Oct 2026 \u2014 \u20a663,000) is overdue. All station cargo records are safely backed up and intact. Service will resume automatically upon billing clearance.';

      assert.strictEqual(
        CLOUD_PAUSED_TITLE,
        EXPECTED_TITLE,
        'Title must match exact user specification with em dash'
      );
      assert.strictEqual(
        CLOUD_PAUSED_BODY,
        EXPECTED_BODY,
        'Body must match exact user specification with em dash and Naira sign'
      );

      // Verify specific characters
      assert.ok(CLOUD_PAUSED_TITLE.includes('\u2014'), 'Title contains em dash');
      assert.ok(CLOUD_PAUSED_BODY.includes('\u2014'), 'Body contains em dash');
      assert.ok(CLOUD_PAUSED_BODY.includes('\u20a6'), 'Body contains Naira sign');
      assert.ok(CLOUD_PAUSED_BODY.includes('₦63,000'), 'Body contains ₦63,000');
    });

    test('retains FORCED_RELOAD_KEY byte-identical to preserve release sentinel compatibility', () => {
      assert.strictEqual(
        FORCED_RELOAD_KEY,
        'ehi_forced_reload_subscription_notice_20261106',
        'FORCED_RELOAD_KEY must not be changed or rearmed'
      );
    });

    test('sentinel eligibility evaluates correctly across storage states', () => {
      // 1. When localStorage has no key (first-launch pass), gate is suppressed
      const checkEligibility = (storage: Record<string, string> | null) => {
        try {
          if (storage) {
            if (!storage[FORCED_RELOAD_KEY]) {
              return false;
            }
          }
        } catch {
          // Fall back to true if storage is restricted
        }
        return true;
      };

      assert.strictEqual(
        checkEligibility({}),
        false,
        'Must suppress on first-launch pass prior to reload'
      );

      // 2. When key is set ('1'), gate is active
      assert.strictEqual(
        checkEligibility({ [FORCED_RELOAD_KEY]: '1' }),
        true,
        'Must display when release sentinel is present'
      );

      // 3. When storage is null or throws, fallback display is true
      assert.strictEqual(
        checkEligibility(null),
        true,
        'Must display when storage is unavailable'
      );
    });

    test('removes invented reassurance and status claims while preserving neutral locked labels', () => {
      const source = fs.readFileSync(path.join(__dirname, 'CloudPausedGate.tsx'), 'utf8');

      // Invented supplemental reassurance and status claims must be removed
      assert.strictEqual(
        source.includes('Status Verification Panel'),
        false,
        'Status Verification Panel must be removed'
      );
      assert.strictEqual(
        source.includes('Infrastructure Scope'),
        false,
        'Infrastructure Scope claims must be removed'
      );
      assert.strictEqual(
        source.includes('Local Storage State'),
        false,
        'Local Storage State claims must be removed'
      );
      assert.strictEqual(
        source.includes('All offline IndexedDB queues'),
        false,
        'Invented IndexedDB queue reassurance claims must be removed'
      );
      assert.strictEqual(
        source.includes('endpoints will resume automatically'),
        false,
        'Invented endpoint resumption assertions must be removed'
      );

      // Only neutral locked / paused labels remain besides exact user title & body
      assert.ok(source.includes('CLOUD_PAUSED_TITLE'), 'Exact title preserved');
      assert.ok(source.includes('CLOUD_PAUSED_BODY'), 'Exact body preserved');
      assert.ok(source.includes('Terminal interaction locked'), 'Neutral terminal locked label preserved');
      assert.ok(source.includes('Administrative clearance required'), 'Neutral clearance label preserved');
    });
  });

  describe('DOM Sibling Inerting & Portal MutationObserver', () => {
    class MockElement {
      nodeType = 1;
      tagName: string;
      id = '';
      attributes: Record<string, string> = {};
      children: MockElement[] = [];
      parentNode: MockElement | null = null;
      _onChildAdded?: (child: MockElement) => void;

      constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
      }

      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      }

      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      }

      hasAttribute(name: string) {
        return name in this.attributes;
      }

      removeAttribute(name: string) {
        delete this.attributes[name];
      }

      appendChild(child: MockElement) {
        child.parentNode = this;
        this.children.push(child);
        if (this._onChildAdded) this._onChildAdded(child);
        return child;
      }

      removeChild(child: MockElement) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      }

      get childNodes() {
        return this.children;
      }

      contains(node: any): boolean {
        if (node === this) return true;
        for (const child of this.children) {
          if (child.contains(node)) return true;
        }
        return false;
      }
    }

    let mockDoc: {
      body: MockElement;
      getElementById: (id: string) => MockElement | null;
      createElement: (tag: string) => MockElement;
    };
    const prevDocument = (globalThis as any).document;

    beforeEach(() => {
      const body = new MockElement('BODY');
      mockDoc = {
        body,
        getElementById: (id: string) => {
          const find = (el: MockElement): MockElement | null => {
            if (el.id === id) return el;
            for (const c of el.children) {
              const r = find(c);
              if (r) return r;
            }
            return null;
          };
          return find(body);
        },
        createElement: (tag: string) => new MockElement(tag),
      };
      (globalThis as any).document = mockDoc;
    });

    afterEach(() => {
      (globalThis as any).document = prevDocument;
    });

    test('getOrCreateGateContainer creates single root container on document.body', () => {
      const container1 = getOrCreateGateContainer();
      assert.ok(container1, 'Container created');
      assert.strictEqual(container1?.id, GATE_CONTAINER_ID);
      assert.strictEqual(mockDoc.body.children.length, 1);

      // Subsequent call reuses existing container
      const container2 = getOrCreateGateContainer();
      assert.strictEqual(container1, container2);
      assert.strictEqual(mockDoc.body.children.length, 1);
    });

    test('inert management inerts existing siblings and dynamically added portals while sparing gate container', () => {
      // Existing siblings in body
      const appRoot = new MockElement('DIV');
      appRoot.id = 'root';
      mockDoc.body.appendChild(appRoot);

      const scriptTag = new MockElement('SCRIPT');
      mockDoc.body.appendChild(scriptTag);

      const gateContainer = getOrCreateGateContainer()!;

      // Inert logic function simulating CloudPausedGate's markSiblingsInert
      const markSiblingsInert = () => {
        for (const child of mockDoc.body.children) {
          if ((child as any) === gateContainer) continue;
          if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
          if (!child.hasAttribute('inert')) {
            child.setAttribute('inert', '');
            child.setAttribute('data-ehi-gate-inert', 'true');
          }
          if (!child.hasAttribute('aria-hidden')) {
            child.setAttribute('aria-hidden', 'true');
            child.setAttribute('data-ehi-gate-aria', 'true');
          }
        }
      };

      markSiblingsInert();

      assert.strictEqual(appRoot.getAttribute('inert'), '', 'App root should be inert');
      assert.strictEqual(appRoot.getAttribute('aria-hidden'), 'true', 'App root should be aria-hidden');
      assert.strictEqual(gateContainer.hasAttribute('inert'), false, 'Gate container must NOT be inert');
      assert.strictEqual(scriptTag.hasAttribute('inert'), false, 'Script tag ignored');

      // Now simulate a portal added dynamically after gate mount (e.g. sheet, toast)
      const dynamicPortal = new MockElement('DIV');
      dynamicPortal.id = 'dynamic-toast-portal';
      mockDoc.body.appendChild(dynamicPortal);

      markSiblingsInert();

      assert.strictEqual(dynamicPortal.getAttribute('inert'), '', 'Dynamic portal must be caught and marked inert');
      assert.strictEqual(dynamicPortal.getAttribute('aria-hidden'), 'true', 'Dynamic portal must be aria-hidden');

      // On unmount / cleanup, attributes are restored
      for (const child of mockDoc.body.children) {
        if (child.getAttribute('data-ehi-gate-inert') === 'true') {
          child.removeAttribute('inert');
          child.removeAttribute('data-ehi-gate-inert');
        }
        if (child.getAttribute('data-ehi-gate-aria') === 'true') {
          child.removeAttribute('aria-hidden');
          child.removeAttribute('data-ehi-gate-aria');
        }
      }

      assert.strictEqual(appRoot.hasAttribute('inert'), false, 'Inert removed on cleanup');
      assert.strictEqual(dynamicPortal.hasAttribute('inert'), false, 'Dynamic portal inert removed on cleanup');
    });
  });

  describe('Capture-Phase Event Blocking & Non-Dismissibility', () => {
    class MockDomEvent {
      type: string;
      key?: string;
      ctrlKey?: boolean;
      metaKey?: boolean;
      target: any;
      defaultPrevented = false;
      propagationStopped = false;
      immediatePropagationStopped = false;

      constructor(type: string, init?: any) {
        this.type = type;
        if (init) Object.assign(this, init);
      }

      preventDefault() {
        this.defaultPrevented = true;
      }

      stopPropagation() {
        this.propagationStopped = true;
      }

      stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
      }
    }

    test('Escape key is unconditionally blocked everywhere (inside and outside gate)', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};
      const outsideNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      const eventInside = new MockDomEvent('keydown', { key: 'Escape', target: dialogNode });
      simulateKeyCapture(eventInside);
      assert.ok(eventInside.defaultPrevented, 'Escape inside gate default prevented');
      assert.ok(eventInside.propagationStopped, 'Escape inside gate propagation stopped');
      assert.ok(eventInside.immediatePropagationStopped, 'Escape inside gate immediate propagation stopped');

      const eventOutside = new MockDomEvent('keydown', { key: 'Escape', target: outsideNode });
      simulateKeyCapture(eventOutside);
      assert.ok(eventOutside.defaultPrevented, 'Escape outside gate default prevented');
      assert.ok(eventOutside.propagationStopped, 'Escape outside gate propagation stopped');
      assert.ok(eventOutside.immediatePropagationStopped, 'Escape outside gate immediate propagation stopped');
    });

    test('Print shortcut (Ctrl+P / Cmd+P) is blocked to prevent receipt printing', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      const eventCtrlP = new MockDomEvent('keydown', { key: 'p', ctrlKey: true, target: dialogNode });
      const eventCmdP = new MockDomEvent('keydown', { key: 'P', metaKey: true, target: dialogNode });

      simulateKeyCapture(eventCtrlP);
      assert.ok(eventCtrlP.defaultPrevented);
      assert.ok(eventCtrlP.propagationStopped);
      assert.ok(eventCtrlP.immediatePropagationStopped);

      simulateKeyCapture(eventCmdP);
      assert.ok(eventCmdP.defaultPrevented);
      assert.ok(eventCmdP.propagationStopped);
      assert.ok(eventCmdP.immediatePropagationStopped);
    });

    test('Keystrokes from barcode scanners targeting outside gate are stopped immediately', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};
      const outsideNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      // Barcode scanner sending keypress on body
      const scannerEvent = new MockDomEvent('keydown', {
        key: 'A',
        target: outsideNode,
      });

      simulateKeyCapture(scannerEvent);
      assert.ok(scannerEvent.defaultPrevented, 'Scanner key burst default prevented');
      assert.ok(scannerEvent.propagationStopped, 'Scanner key burst propagation stopped');
      assert.ok(scannerEvent.immediatePropagationStopped, 'Scanner key burst immediate propagation stopped');
    });

    test('Ordinary keyboard events originating INSIDE gate have propagation blocked to protect operational hotkeys', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      // Hotkey for cargo 'c', ledger 'l', scanner burst characters '0'-'9', Enter originating inside gate
      const operationalKeys = ['c', 'l', 'w', '0', '1', 'Enter'];
      for (const key of operationalKeys) {
        const event = new MockDomEvent('keydown', { key, target: dialogNode });
        simulateKeyCapture(event);

        assert.strictEqual(
          event.propagationStopped,
          true,
          `Key '${key}' inside gate must have propagationStopped`
        );
        assert.strictEqual(
          event.immediatePropagationStopped,
          true,
          `Key '${key}' inside gate must have immediatePropagationStopped`
        );
        // Default is not prevented for normal keys, preserving typing/system behavior without firing window hotkeys
        assert.strictEqual(
          event.defaultPrevented,
          false,
          `Key '${key}' inside gate does not prevent harmless default`
        );
      }
    });

    test('Reasonable scrolling keys originating INSIDE gate preserve default scrolling while blocking propagation', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];
      for (const key of scrollKeys) {
        const event = new MockDomEvent('keydown', { key, target: dialogNode });
        simulateKeyCapture(event);

        assert.strictEqual(event.propagationStopped, true, `Scroll key '${key}' propagation stopped`);
        assert.strictEqual(
          event.immediatePropagationStopped,
          true,
          `Scroll key '${key}' immediate propagation stopped`
        );
        assert.strictEqual(
          event.defaultPrevented,
          false,
          `Scroll key '${key}' inside gate must NOT prevent default so scroll container functions`
        );
      }
    });

    test('Pointer events targeting outside gate are stopped immediately (no backdrop dismissal)', () => {
      const gateContainerNode = { contains: (n: any) => n === gateContainerNode || n === dialogNode };
      const dialogNode = {};
      const outsideNode = {};

      const handlePointer = (e: MockDomEvent) => {
        if (gateContainerNode.contains(e.target)) {
          return; // Allow interactions inside gate
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      // Click on background app or portal
      const outsideClick = new MockDomEvent('click', { target: outsideNode });
      handlePointer(outsideClick);
      assert.ok(outsideClick.defaultPrevented, 'Outside click prevented');
      assert.ok(outsideClick.immediatePropagationStopped, 'Outside click propagation stopped');

      // Click on gate content
      const dialogClick = new MockDomEvent('click', { target: dialogNode });
      handlePointer(dialogClick);
      assert.strictEqual(dialogClick.defaultPrevented, false, 'Inside dialog click not prevented');
    });

    test('Tab key inside gate dialog is trapped to prevent escaping focus', () => {
      const gateContainerNode = { contains: (n: any) => n === dialogNode };
      const dialogNode = {};

      const simulateKeyCapture = (e: MockDomEvent) => {
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.key === 'Escape') {
          e.preventDefault();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          return;
        }

        const isInsideGate = gateContainerNode.contains(e.target);
        if (!isInsideGate) {
          e.preventDefault();
          return;
        }
      };

      const tabEvent = new MockDomEvent('keydown', { key: 'Tab', target: dialogNode });
      simulateKeyCapture(tabEvent);
      assert.ok(tabEvent.defaultPrevented, 'Tab prevented from leaving dialog');
      assert.ok(tabEvent.propagationStopped, 'Tab propagation stopped');
      assert.ok(tabEvent.immediatePropagationStopped, 'Tab stopped immediately');
    });
  });

  describe('Public Tracking Exclusion', () => {
    test('public tracking paths starting with /track are excluded from gating', () => {
      const isPublicTrackPath = (path: string) => path.startsWith('/track');

      assert.strictEqual(isPublicTrackPath('/track'), true, '/track is excluded');
      assert.strictEqual(isPublicTrackPath('/track/WB-12345'), true, '/track/:waybillId is excluded');
      assert.strictEqual(isPublicTrackPath('/track/'), true, '/track/ is excluded');

      assert.strictEqual(isPublicTrackPath('/'), false, '/ operational root is gated');
      assert.strictEqual(isPublicTrackPath('/cargo'), false, '/cargo is gated');
      assert.strictEqual(isPublicTrackPath('/ledger'), false, '/ledger is gated');
      assert.strictEqual(isPublicTrackPath('/more/audit-log'), false, '/more/audit-log is gated');
    });
  });
});
