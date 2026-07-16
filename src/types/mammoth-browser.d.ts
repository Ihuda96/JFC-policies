declare module "mammoth/mammoth.browser" {
  interface ConvertToHtmlInput {
    arrayBuffer: ArrayBuffer;
  }

  interface MammothMessage {
    type: string;
    message: string;
  }

  interface ConvertToHtmlResult {
    value: string;
    messages: MammothMessage[];
  }

  interface ConvertOptions {
    styleMap?: string[];
    includeDefaultStyleMap?: boolean;
  }

  const mammoth: {
    convertToHtml(
      input: ConvertToHtmlInput,
      options?: ConvertOptions,
    ): Promise<ConvertToHtmlResult>;
  };

  export default mammoth;
}
