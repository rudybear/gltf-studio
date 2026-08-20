// AG-018: the `tools` array sent on every request — an OpenAI-style
// function-tool schema, one entry per editor operation this provider is
// willing to build a Command for. This is the ONLY channel the model has
// for proposing a change (see response-parser.ts) — there is no code path
// anywhere in this package that turns response TEXT into a document
// mutation.
//
// Each tool is a thin, parameterized wrapper over a real editor-core
// GraphEdit/SceneEdit factory (see tool-handlers.ts for the resolution),
// mirroring the shape packages/agent-mock's four templates already build by
// hand (spin.ts, move.ts, play-sound.ts, add-cube.ts) — the LLM-facing
// schema just parameterizes what those templates hard-coded. Two entries
// (set_node_transform, add_pointer_interpolate_node) are direct 1:1
// wrappers over a single factory, offered for flexibility beyond the
// narrower request-shaped tools above them (docs/adr/0005's "curated
// subset... sized to what a tool-calling model can reliably use" note).
export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const AXIS_ENUM = ["x", "y", "z"] as const;

export const TOOL_SCHEMA: OpenAIToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "spin_node_on_event",
      description:
        "Continuously or on-trigger rotate a scene node about one axis, driven by an interactivity-graph event (e.g. onTick for continuous spin, onSelect for spin-on-click).",
      parameters: {
        type: "object",
        properties: {
          nodeIndex: { type: "integer", minimum: 0, description: "Index into the document's nodes[] array to rotate." },
          eventOp: {
            type: "string",
            description: 'The KHR_interactivity event declaration to trigger the spin, e.g. "event/onTick" or "event/onSelect".'
          },
          axis: { type: "string", enum: AXIS_ENUM, description: "World axis to rotate about." },
          degreesPerSecond: { type: "number", exclusiveMinimum: 0, description: "Angular rate of the spin, in degrees per second." }
        },
        required: ["nodeIndex", "eventOp", "axis", "degreesPerSecond"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_node",
      description: "Translate a scene node by an [x, y, z] offset, either relative to its current translation or as an absolute new translation.",
      parameters: {
        type: "object",
        properties: {
          nodeIndex: { type: "integer", minimum: 0, description: "Index into the document's nodes[] array to move." },
          translation: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
            description: "[x, y, z] offset (if relative) or new translation (if absolute)."
          },
          relative: { type: "boolean", description: "true: add to the node's current translation. false: set translation outright." }
        },
        required: ["nodeIndex", "translation", "relative"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "play_sound_on_event",
      description:
        "Wire an interactivity-graph event to trigger playback of a node's KHR_audio_emitter sound (the node must already have an audio emitter with a source).",
      parameters: {
        type: "object",
        properties: {
          nodeIndex: { type: "integer", minimum: 0, description: "Index into nodes[] that fires the event (e.g. the clicked node)." },
          eventOp: {
            type: "string",
            description: 'The KHR_interactivity event declaration that triggers playback, e.g. "event/onSelect" or "event/onTick".'
          },
          soundNodeIndex: {
            type: "integer",
            minimum: 0,
            description: "Index into nodes[] whose KHR_audio_emitter provides the sound to play (often the same as nodeIndex)."
          }
        },
        required: ["nodeIndex", "eventOp", "soundNodeIndex"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_cube",
      description: "Procedurally generate a solid-color cube primitive (mesh + material + node) and add it to the scene.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: 'Display name for the generated node/mesh. Defaults to "Generated cube" if omitted.' },
          halfExtent: { type: "number", exclusiveMinimum: 0, description: "Half the cube's side length. Defaults to 0.5 (a 1x1x1 cube)." },
          parentNodeIndex: { type: "integer", minimum: 0, description: "If given, parent the new node under this existing node instead of the scene root." }
        },
        required: [],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_node_transform",
      description: "Directly set one or more of a node's translation/rotation/scale fields outright (no animation). A generic transform edit.",
      parameters: {
        type: "object",
        properties: {
          nodeIndex: { type: "integer", minimum: 0, description: "Index into nodes[] to edit." },
          translation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z], if changing translation." },
          rotation: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description: "[x, y, z, w] quaternion, if changing rotation."
          },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z], if changing scale." }
        },
        required: ["nodeIndex"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_pointer_interpolate_node",
      description:
        "Add a pointer/get, pointer/set, or pointer/interpolate KHR_interactivity graph node targeting an arbitrary document pointer path — a generic building block for wiring custom graph logic beyond the more specific tools above.",
      parameters: {
        type: "object",
        properties: {
          graphIndex: { type: "integer", minimum: 0, description: "Index into extensions.KHR_interactivity.graphs[] to add the node to." },
          pointerPath: { type: "string", description: 'JSON-pointer-shaped path the node targets, e.g. "/nodes/0/rotation".' },
          signature: { type: "string", description: 'The pointer value\'s KHR_interactivity type signature, e.g. "float4", "float3", "bool".' },
          kind: { type: "string", enum: ["get", "set", "interpolate"], description: "Which pointer node op to add." }
        },
        required: ["graphIndex", "pointerPath", "signature", "kind"],
        additionalProperties: false
      }
    }
  }
];

export const TOOL_SUMMARY_FOR_SYSTEM_PROMPT: string = TOOL_SCHEMA.map((t) => `- ${t.function.name}: ${t.function.description}`).join("\n");
