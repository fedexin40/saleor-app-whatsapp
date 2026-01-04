// src/pages/api/webhooks/order-fulfilled.ts

import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import type { NextApiRequest, NextApiResponse } from "next";
import { saleorApp } from "../../../saleor-app";


type MetadataItem = {
  key: string;
  value: string;
};

type OrderFulfilledPayload = {
  __typename: "OrderFulfilled";
  order: {
    id: string;
    number: string;
    shippingAddress: {
      phone: string | null;
      firstName: string | null;
    } | null;
    fulfillments: {
      trackingNumber: string;
      metadata: MetadataItem[];
    }[];
    metadata: MetadataItem[];
  };
};

const orderFulfilledSubscription = `
  subscription OrderFulfilled {
    event {
      __typename
      ... on OrderFulfilled {
        order {
          id
          number
          shippingAddress {
            firstName
            lastName
            phone
          }
          fulfillments {
            trackingNumber
            metadata {
              key
              value
            }
          }
          metadata {
            key
            value
          }
        }
      }
    }
  }
`;

function getMetadataValue(
  items: MetadataItem[] | null | undefined,
  key: string
): string | null {
  if (!items) return null;
  const found = items.find((m) => m.key === key);
  return found?.value ?? null;
}

/**
 * Enviar WhatsApp (template con variables por nombre)
 *
 * Variables esperadas:
 *  {{no_pedido}}
 *  {{tracking_number}}
 *  {{url_tracking}}
 */
async function sendOrderFulfilledWhatsApp(params: {
  phoneNumber: string;
  orderNumber: string;
  trackingNumber: string;
  trackingUrl: string;
  customerName: string;
}) {
  const { phoneNumber, orderNumber, trackingNumber, trackingUrl, customerName } = params;

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = 'shipment_send';
  const templateLangCode = 'es';

  if (!token || !phoneNumberId) {
    console.error("Config faltante: WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: phoneNumber,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLangCode },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: customerName,
              parameter_name: "nombre",
            },
            {
              type: "text",
              text: orderNumber,
              parameter_name: "no_pedido",
            },
            {
              type: "text",
              text: trackingNumber,
              parameter_name: "tracking_number",
            },
            {
              type: "text",
              text: trackingUrl,
              parameter_name: "url_tracking",
            }
          ]
        }
      ]
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.error(
      "Error al enviar WhatsApp (ORDER_FULFILLED):",
      response.status,
      await response.text()
    );
  } else {
    console.log("WhatsApp ORDER_FULFILLED enviado correctamente a:", phoneNumber);
  }
}

export const orderFulfilledWebhook =
  new SaleorAsyncWebhook<OrderFulfilledPayload>({
    name: "Order fulfilled",
    webhookPath: "/api/webhooks/order-fulfilled",
    event: "ORDER_FULFILLED",
    apl: saleorApp.apl,
    query: orderFulfilledSubscription,
  });

export default orderFulfilledWebhook.createHandler(
  async (req: NextApiRequest, res: NextApiResponse, ctx) => {
    const { payload } = ctx;

    try {
      const order = payload.order;
      if (!order) return res.status(200).end();

      const phone = order.shippingAddress?.phone;
      if (!phone) {
        console.log("No phone → no WhatsApp enviado");
        return res.status(200).end();
      }
      const orderNumber = order.number;
      const customerName = order.shippingAddress?.firstName ? order.shippingAddress?.firstName.charAt(0).toUpperCase() + order.shippingAddress?.firstName.slice(1) : 'querido cliente';

      // Tracking number: tomamos el primero disponible
      const fulfillment = order.fulfillments.find(
        (f) => f.trackingNumber && f.trackingNumber.trim() !== ""
      );
      const trackingNumber = fulfillment?.trackingNumber || "N/A";

      // tracking_url_provider en metadata
      let trackingUrl =
        getMetadataValue(order.metadata, "tracking_url_provider") || "";

      if (!trackingUrl && fulfillment) {
        trackingUrl =
          getMetadataValue(fulfillment.metadata, "tracking_url_provider") || "";
      }

      if (!trackingUrl) trackingUrl = "N/A";

      await sendOrderFulfilledWhatsApp({
        phoneNumber: phone,
        orderNumber,
        trackingNumber,
        trackingUrl,
        customerName
      });

    } catch (err) {
      console.error("Error manejando ORDER_FULFILLED:", err);
      return res.status(500).json({ message: err });
    }

    return res.status(200).end();
  }
);

export const config = {
  api: { bodyParser: false }
};
