// The Gate encounter, as drawn in the owner's Figma frame.
// This page is a FIXED ILLUSTRATION of the design: every number on it (the refund,
// what was paid, the rule count) is invented and scripted. Nothing here reads the
// database, and nothing here can change an order. The live Human Desk reuses the
// same chrome with real queue data.
import {
  AmountBlock,
  Badge,
  ClosingLine,
  ConsoleRail,
  DeviceStrip,
  DialogueAction,
  DialogueBar,
  Divider,
  EncounterIndicator,
  EncounterPanel,
  IdentityChip,
  LockStrip,
  PanelBody,
  PanelHeader,
  PanelHeading,
  RobotPortrait,
  RuleRow,
  Scene,
  Stage,
  StatusRow,
  VillageShell,
} from "../ui.tsx";

export const metadata = { title: "Gate encounter (illustration) | Approval Desk" };

export default function GateEncounterPage() {
  return (
    <VillageShell chapter="The gatekeeper" activeStage="gate" shortcut={{ keyCap: "L", label: "Logbook", count: "00", href: "/" }}>
      <Stage label="Gate encounter">
        <Scene placeName="Gate plaza" placeNumber="03" currentPlace="gate">
          <IdentityChip>Gatekeeper · awaiting review</IdentityChip>
        </Scene>
        <ConsoleRail>
          <EncounterIndicator>Rule check encounter</EncounterIndicator>
          <EncounterPanel label="Rule scan">
            <PanelHeader title="Gate / rule scan" aside="02 rules" />
            <PanelBody>
              <PanelHeading badge={<Badge tone="red">Blocked</Badge>}>Refund 01003</PanelHeading>
              <AmountBlock label="Requested refund" amount="$500.00" tone="red" />
              <Divider />
              <RuleRow tone="red" symbol="×" title="More than was paid" sub="Order paid $20.00" />
              <RuleRow tone="blue" symbol="!" title="Over the $100 limit" sub="Needs a human" />
              <StatusRow title="Human review required" sub="Next stop → Human desk" />
              <LockStrip>Factory locked · no payout issued</LockStrip>
              <ClosingLine>Both flags need a human&rsquo;s attention. Your next stop is the Human Desk.</ClosingLine>
            </PanelBody>
          </EncounterPanel>
        </ConsoleRail>
      </Stage>
      <DialogueBar
        portrait={<RobotPortrait />}
        speakerName="Rule keeper"
        speakerLabel="The gate"
        subLabel="Rule check"
        headline="The gate checks every rule..."
        body="This refund can't pass. Let's take it to the Human Desk."
        actions={
          <>
            <DialogueAction variant="primary" keyCap="A" label="Go to human desk" href="/approvals" />
            <DialogueAction variant="secondary" keyCap="B" label="Back to village" href="/village" />
          </>
        }
      />
      <DeviceStrip right="Scripted illustration" />
    </VillageShell>
  );
}
