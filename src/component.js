/* @flow */

import { getClientToken } from 'paypal-braintree-web-client/src';

// toodoo unvendor this when braintree-web is updated
import btClient from '../vendor/braintree-web/client';
import hostedFields from '../vendor/braintree-web/hosted-fields';

import contingencyFlow from './contingency-flow';
import type { HostedFieldsHandler } from './types';

let TESTING_CONFIGURATION = {
  assetsUrl: 'https://payments-sdk-demo-assets.herokuapp.com',
  card:      {
    supportedCardBrands: [ 'VISA' ]
  }
};

function createSubmitHandler (hostedFieldsInstance, orderIdFunction) : Function {
  return () => {
    return orderIdFunction().then((orderId) => {
      return hostedFieldsInstance.tokenize({
        orderId
      }).catch((err) => {
        console.log('contingency error', err);
        if (!(err.details && err.details.find && err.details.find(detail => detail.issue === 'CONTINGENCY'))) {
          return Promise.reject(err);
        }

        let url = err.links.find(link => link.rel === '3ds-contingency-resolution').href + '&xcomponent=1';

        console.log('opening contingency url', url);
        return contingencyFlow.start(url);
      }).then(() => {
        return { orderId };
      });
    });
  };
}

export let HostedFields = {
  render(options, buttonSelector) : Promise<HostedFieldsHandler> {

    // toodoo - revert change below when config is being passed correctly
    let configuration = (typeof __hosted_fields__ !== 'undefined') ? __hosted_fields__.serverConfig : TESTING_CONFIGURATION;
    configuration.assetsUrl = TESTING_CONFIGURATION.assetsUrl;
    if (!configuration.card && configuration.paypalMerchantConfiguration && configuration.paypalMerchantConfiguration.creditCard) {
      configuration.card = configuration.paypalMerchantConfiguration.creditCard;
    } else {
      // configuration.card = TESTING_CONFIGURATION.card;
    }
    console.log('Using config');
    console.log(configuration);

    let clientToken = getClientToken();

    let correlationId = __CORRELATION_ID__;
    configuration.correlationId = correlationId;

    let orderIdFunction = () => {
      return Promise.resolve().then(() => {
        return options.payment();
      });
    };
    let button;

    if (buttonSelector && options.onAuthorize) {
      button = document.querySelector(buttonSelector);
      if (!button) {
        return Promise.reject(new Error(`Could not find selector \`${ buttonSelector }\` on the page`));
      }
    }

    return btClient.create({
      authorization: clientToken,
      paymentsSdk:   true,
      configuration
    }).then((btClientInstance) => {
      let hostedFieldsCreateOptions = JSON.parse(JSON.stringify(options));

      hostedFieldsCreateOptions.paymentsSdk = true;
      hostedFieldsCreateOptions.client = btClientInstance;
      return hostedFields.create(hostedFieldsCreateOptions);
    }).then((hostedFieldsInstance) => {
      hostedFieldsInstance.submit = createSubmitHandler(hostedFieldsInstance, orderIdFunction);

      if (button) {
        button.addEventListener('click', () => {
          hostedFieldsInstance.submit().then((payload) => {
            return options.onAuthorize(payload);
          }).catch((err) => {

            if (options.onError) {
              options.onError(err);
            }
          });
        });
      }

      return hostedFieldsInstance;
    });
  }
};
