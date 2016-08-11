"use strict"

const SteamUser = require('steam-user')
const Steamcommunity = require('steamcommunity')
const SteamTotp = require('steam-totp')
const TradeOfferManager = require('steam-tradeoffer-manager') // use require('steam-tradeoffer-manager') in production
const request = require('request')
const fs = require('fs')
const _ = require('lodash')
const ErrorsEnum = require('./errorsenum.js')
const kue = require('kue')
const queue = kue.createQueue();


/**
* You need to setup your API Endpoint if you want to get
* Updates of your trades.
*/
const API_URL = 'http://localhost:3000'
const API_UPDATE_STATUS = API_URL + '/api/trade/status'
const API_UPDATE_TRADE_ID = API_URL + '/api/trade/tradeid'
/**
* Steam / Trade Manager
*/
const client = new SteamUser()
const manager = new TradeOfferManager({
  "steam": client, // Polling every 30 seconds is fine since we get notifications from Steam
  "domain": "localhost.com", // Our domain is example.com
  "language": "en", // We want English item descriptions
  "cancelTime" : "600000"
})
const TradeHelper = require('./lib/tradehelper')(manager);
const community = new Steamcommunity()

// Steam logon options
const logOnOptions = {
  "accountName": "ACCOUNT_NAME",
  "password": "PASSWORD",
  "twoFactorCode": SteamTotp.getAuthCode("YOUR_CODE")
}

/// Bot Login and Setup Status
let isUpAndRunningObj = {
  'logged_in' : true,
  'cookies_set' : true,
  isRunning : function(){
    return this.logged_in && this.cookies_set === true
  }
}

if (fs.existsSync('polldata.json')) {
  manager.pollData = JSON.parse(fs.readFileSync('polldata.json'))
}




client.logOn(logOnOptions)

client.on('loggedOn', function() {
  console.log("Logged into Steam")

})

client.on('webSession', function(sessionID, cookies) {
  manager.setCookies(cookies, function(err) {
    if (err) {
      console.log(err)
      process.exit(1) // Fatal error since we couldn't get our API key
      return
    }
    console.log("Got API key: " + manager.apiKey)
    isUpAndRunningObj.logged_in = true
  })

  community.setCookies(cookies)
  community.startConfirmationChecker(30000, "identitySecret") // Checks and accepts confirmations every 30 seconds

  isUpAndRunningObj.cookies_set = true

})

manager.on('pollData', function(pollData) {
  fs.writeFile('polldata.json', JSON.stringify(pollData));
});

manager.on('newOffer', function(offer) {
  console.log("New offer #" + offer.id + " from " + offer.partner.getSteam3RenderedID())
  if(!offer.isOurOffer) {
    offer.decline(function(err) {
      if (err) {
        console.log("Unable to decline offer: ")
      } else {
        console.log("Offer declined")
      }
    })
  }

})

manager.on('sentOfferChanged', function (offer, oldState) {
  // Alert us when one of our offers is accepted
  //
  //

  let tradeStatus = {
    steam_trade_id : offer.id,
    trade_status : ''
  }

  if (offer.state == TradeOfferManager.ETradeOfferState.Accepted) {
    tradeStatus.trade_status = 'accepted'
    console.log("Our sent offer #"+ offer.id + " has been accepted.");

    offer.getReceivedItems(function(err, items){
      console.log(items)
    })
    updateTradeStatus(tradeStatus).catch((error) => {
      console.log(error)
    })
  }else if (offer.state == TradeOfferManager.ETradeOfferState.Declined) {
    tradeStatus.trade_status = 'declined'

    console.log("Our sent offer #"+ offer.id + " has been declined.");

    updateTradeStatus(tradeStatus).catch((error) => {
      console.log(error)
    })
  } else {
    tradeStatus.trade_status = 'cancelled'
    updateTradeStatus(tradeStatus).then(() => {

      console.log('Offer cancelled update '+ offer.id )
      offer.cancel(function(err){
        if(!err){
          console.log('Offer cancelled successfully')
        }else {
          console.log(err)
        }
      })
    }).catch((error) => {
      console.log(error)
    })
  }

});

manager.on('unknownOfferSent', function(offer) {
  let tradeStatus = {
    steam_trade_id : offer.id,
    trade_status : 'cancelled'
  }

  updateTradeStatus(tradeStatus).then(() => {

    console.log('Offer cancelled update '+ offer.id )
    offer.cancel(function(err){
      if(!err){
        console.log('Offer cancelled successfully')
      }
    })
  }).catch((error) => {
    console.log(error)
  })
})
manager.on('sentPendingOfferCanceled', function(offer) {
  let tradeStatus = {
    steam_trade_id : offer.id,
    trade_status : 'cancelled'
  }

  updateTradeStatus(tradeStatus).then(() => {

    console.log('Pending Offer cancelled update '+ offer.id )
    offer.cancel(function(err){
      if(!err){
        console.log('Pending Offer cancelled successfully')
      }
    })
  }).catch((error) => {
    console.log(error)
  })
})

/**
* You need to push jobs to this queue
* Verication_code is your own generated code
* Trade_uid is your trade id in the database
* steam_id the user's steam id you are trading with
* User_items an array of items (steam-tradeoffer-manager format)
* Bot_items same as above but your items
* UserToken, the user's steam token (If you are not friends on steam)
*/
queue.process('trade', function(job, done){
  const data = job.data
  const verificationCode = data.verification_code
  const tradeUID = data.trade_uid
  const customerSteamID = data.steam_id
  const itemsToReceiveArray = data.user_items
  const itemsToGiveArray = data.bot_items
  const userToken = data.userToken

  createOffer({
    verification_code : verificationCode,
    trade_uid : tradeUID,
    customer_steam_id : customerSteamID,
    items_to_receive : itemsToReceiveArray,
    items_to_send : itemsToGiveArray,
    user_token : userToken,
    done : done
  });
});

/**
* Create a new Trade Offer with the items to Give/Receive
*/
const createOffer = (data) => {
  const verificationCode = data.verification_code
  const tradeDbUID = data.trade_uid
  const customerSteamID = data.customer_steam_id
  const itemsToReceiveArray = data.items_to_receive
  const itemsToGiveArray = data.items_to_send
  const userToken = data.user_token
  const done = data.done //Kue callback
  // Checking if the bot has been initialized.
  console.log('Verification code', verificationCode)
  if(!isUpAndRunningObj.isRunning){
    return done(new Error('not logged in'));
  }

  TradeHelper.getEscrowDays(customerSteamID, userToken)
  .then(TradeHelper.checkEscrowAcceptance)
  .then(() => {
    return TradeHelper.loadBotAndUserInventory(customerSteamID, itemsToReceiveArray, itemsToGiveArray)
  })
  .then((inventoryArray) => {
    console.log(inventoryArray)
    const botInv = _.filter(inventoryArray, { inventory_type : 'bot' })
    const userInv = _.filter(inventoryArray, { inventory_type : 'user' })
    console.log(userInv[0])
    return Promise.resolve({
      verification_code : verificationCode,
      steam_user_id : customerSteamID,
      bot_inventory : botInv[0].inventory,
      user_inventory : userInv[0].inventory,
      user_token : userToken
    })
  })
  .then(TradeHelper.initiateTrade)
  .then((tradeInfo) => {
    const steamTradeId = tradeInfo.trade.id
    const tradeStatus = tradeInfo.status
    const tradeObj = {
      steam_trade_id : steamTradeId,
      trade_status : tradeStatus,
      trade_db_uid : tradeDbUID
    }
    updateTradeID(tradeObj).then(() => {
      return updateTradeStatus(tradeObj)
    }).then(() => {
      return done();
    }).catch((err) => {
      console.log(err)
    })
  })
  .catch((error) => {
    console.log('Error issued', error.message)
    let tradeStatus = {
      verification_code : verificationCode,
      trade_status : 'error',
      message : error.message
    }

    updateTradeStatus(tradeStatus).catch((error) => {
      console.log(error)
    })
    return done(new Error(error));
  })
}

const updateTradeStatus = (data) => {
  return new Promise((resolve, reject) => {
    const tradeStatus = data.trade_status

    let dataObj = {
      trade_status : tradeStatus,
    }

    if(data.hasOwnProperty('steam_trade_id')) {
      console.log('has steam trade id')
      dataObj['steam_trade_id'] = data.steam_trade_id
    } else if (data.hasOwnProperty('verification_code')) {
      console.log('has verification code id ')
      dataObj['verification_code'] = data.verification_code

    }
    console.log(dataObj)
    request({url : API_UPDATE_STATUS, method : 'POST', json : dataObj}, function(err, response, body) {
      if(!err && response.statusCode == 200){
        console.log('Sent new data to motherbase Trade Status')
        return resolve()
      } else {
        return reject(err)
      }
    })
  })

}

const updateTradeID = (data) => {

  return new Promise((resolve, reject) => {
    const tradeDbUID = data.trade_db_uid
    const steamTradeId = data.steam_trade_id

    const dataObj = {
      trade_db_uid : tradeDbUID,
      steam_trade_id : steamTradeId,
    }

    request({url : API_UPDATE_TRADE_ID, method : 'POST', json : dataObj}, function(err, response, body) {
      if(!err && response.statusCode == 200){
        console.log('Sent new data to motherbase Update Trade ID')
        console.log(body)
        return resolve()
      } else {
        return reject(err)
      }
    })
  })

}
