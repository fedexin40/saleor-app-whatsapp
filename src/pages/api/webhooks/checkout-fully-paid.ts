import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { NextApiHandler } from "next";
import { gql } from "urql";
import { CheckoutFullyPaidWebhookPayloadFragment } from "../../../../generated/graphql";
import { saleorApp } from "../../../saleor-app";


/**
 * Example payload of the webhook. It will be transformed with graphql-codegen to Typescript type: OrderCreatedWebhookPayloadFragment
 */
const CheckoutFullyPaidWebhookPayload = gql`
  fragment CheckoutFullyPaidWebhookPayload on CheckoutFullyPaid {
    checkout {
      totalPrice {
        gross {
          currency
          amount
        }
      }
      shippingAddress {
        phone
        lastName
        firstName
      }
    }
  }
`;

/**
 * Top-level webhook subscription query, that will be attached to the Manifest.
 * Saleor will use it to register webhook.
 */
const CheckoutFullyPaidGraphqlSubscription = gql`
  # Payload fragment must be included in the root query
  ${CheckoutFullyPaidWebhookPayload}
  subscription CheckoutFullyPaid {
    event {
      ...CheckoutFullyPaidWebhookPayload
    }
  }
`;

async function sendWhatsAppMessage(params: {
  phoneNumber: string;
  customerName?: string | null;
  totalAmount: number;
  currency: string;
}) {
  const { phoneNumber, customerName, totalAmount, currency } = params;

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error(
      "WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están configurados en el entorno"
    );
    return;
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  // Adjust the template name
  const templateName = 'payment_successful'
  const templateLangCode = 'es'

  const body = {
    messaging_product: "whatsapp",
    to: phoneNumber,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: templateLangCode,
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: customerName, parameter_name: "nombre" },
            { type: "text", text: totalAmount.toFixed(2), parameter_name: "total" }
          ],
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Error al enviar WhatsApp:", response.status, errorText);
  } else {
    console.log("WhatsApp enviado correctamente al cliente:", phoneNumber);
  }
}

/**
 * Create abstract Webhook. It decorates handler and performs security checks under the hood.
 *
 * orderCreatedWebhook.getWebhookManifest() must be called in api/manifest too!
 */
export const checkoutFullyPaidWebhook = new SaleorAsyncWebhook<CheckoutFullyPaidWebhookPayloadFragment>({
  name: "Checkout Fully Paid in Saleor",
  webhookPath: "api/webhooks/checkout-fully-paid",
  event: "CHECKOUT_FULLY_PAID",
  apl: saleorApp.apl,
  query: CheckoutFullyPaidGraphqlSubscription,
});

const checkoutFullyPaidHandler: NextApiHandler = async (req: any, res: any) => {
  let domain = new URL(process.env.NEXT_PUBLIC_SALEOR_HOST_URL || "");
  req.headers["saleor-domain"] = `${domain.host}`;
  req.headers["x-saleor-domain"] = `${domain.host}`;

  const saleorApiUrl = process.env.NEXT_PUBLIC_SALEOR_HOST_URL + "/graphql/";
  req.headers["saleor-api-url"] = saleorApiUrl;

  return checkoutFullyPaidWebhook.createHandler(async (req: any, res: any, ctx) => {
    console.log("Checkout Fully Paid webhook received");

    const { payload, authData, event } = ctx;

    try {

      const checkout = payload.checkout
      if (!checkout) {
        console.warn("No se encontró checkout en el payload");
      } else {
        const shippingAddress = checkout.shippingAddress;
        const phone = shippingAddress?.phone || '522211664477' || undefined;
        const customerName = shippingAddress?.firstName ? shippingAddress?.firstName.charAt(0).toUpperCase() + shippingAddress?.firstName.slice(1) : 'querido comprador';
        const totalAmount = checkout.totalPrice.gross.amount;
        const currency = checkout.totalPrice.gross.currency;

        if (!phone) {
          console.warn(
            "No se encontró teléfono en shippingAddress.phone. No se enviará WhatsApp."
          );
        } else {
          await sendWhatsAppMessage({
            phoneNumber: phone,
            customerName,
            totalAmount,
            currency,
          });
        }
      }

    } catch (err) {
      console.log({ err });
      return res.status(500).json({ message: err });
    }

    console.log('Event handled')
    return res.status(200).json({ message: "event handled" });
  })(req, res);
};

export default checkoutFullyPaidHandler;

/**
 * Disable body parser for this endpoint, so signature can be verified
 */
export const config = {
  api: {
    bodyParser: false,
  },
};
