declare module '@aws-sdk/client-ses' {
  export class SESClient {
    constructor(config: { region?: string });
    send(command: any): Promise<any>;
  }
  export class SendEmailCommand {
    constructor(input: {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: {
        Subject: { Data: string; Charset?: string };
        Body: {
          Text?: { Data: string; Charset?: string };
          Html?: { Data: string; Charset?: string };
        };
      };
    });
  }
}
