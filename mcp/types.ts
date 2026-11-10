/** The MCP tool-result envelope every group's handlers return. */
export type TToolResultContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "audio";
      readonly data: string;
      readonly mimeType: string;
    };

export type TToolResult = {
  content: Array<TToolResultContent>;
  isError?: boolean;
};

/** Flatten an MCP tool result to the text the model should see. */
export const toolResultText = (result: {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly isError?: boolean;
}): string => {
  const text = result.content
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("\n");
  return result.isError === true ? `Error: ${text}` : text;
};
