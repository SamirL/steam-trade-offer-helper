"use strict";

const _ = require('lodash');

/**
* Takes a Steam Trade Offer Manager Instance
*/
module.exports = (manager) => {
  let module = {};

  module.initiateTrade = (tradeObj) => {
    return new Promise((resolve, reject) => {
      const verificationCode = tradeObj.verification_code
      const userSteamID = tradeObj.steam_user_id
      const userInventory = tradeObj.user_inventory
      const botInventory = tradeObj.bot_inventory
      const token = tradeObj.user_token

      const newTrade = manager.createOffer(userSteamID)
      const botItems = newTrade.addMyItems(botInventory)
      console.log(botItems, 'bot items added')
      //
      const userItems = newTrade.addTheirItems(userInventory)
      console.log(userItems, 'user items added')

      if(userItems != userInventory.length ){
        return reject(new Error('User items not properly added'));
      } else if (botItems != botInventory.length) {
        return reject(new Error('Bot items not properly added'));
      }

      const verificationMsg =  `Hello, thank you for trading with us : The verification number is ${verificationCode}`

      newTrade.send(verificationMsg, token, function(err, status) {
        if(err){
          return reject(err);
        }
        console.log('Trade status is  ' +status);
        return resolve({status : status, trade : newTrade});
      });
    });
  }

  module.loadBotAndUserInventory = (steamID, itemsToReceiveArray, itemsToGiveArray) => {
    return Promise.all([
      module.loadUserInventoryWithFilter(steamID,'730', '2', itemsToReceiveArray),
      module.loadBotInventoryWithFilter('730', '2', itemsToGiveArray)
    ])
  }

  module.loadUserInventoryWithFilter = (steamID, appId, contextId, itemsToReceiveArray) => {
    return new Promise((resolve, reject) => {

      //We always need to receive an item, so commented
      if(itemsToReceiveArray.length < 1){
        return reject(new Error("No items from the user were given"))
      }
      manager.loadUserInventory(steamID, appId, contextId, true, function(err, inventory){
        if(err){
          console.log(err)
          return reject(err)
        }

        const filteredInventory = compareInventories(itemsToReceiveArray, inventory)
        if(!filteredInventory) {
          return reject(new Error("User Inventory not matching"))
        }
        console.log('User Inventory matches the payload')
        return resolve({inventory_type : 'user', inventory : filteredInventory })

      })
    })
  }

  /**
  * Load the Bot Inventory Filtered with the Items to Give
  * @method
  * @param  {string} appId            =             '730' app Id (Cs go)
  * @param  {string} contextId        =             '2'
  * @param  {array} itemsToGiveArray                array of Items
  * @return {Promise}
  */
  module.loadBotInventoryWithFilter = (appId = '730', contextId = '2', itemsToGiveArray) => {
    return new Promise((resolve, reject) => {
      if(itemsToGiveArray.length < 1){
        return resolve({inventory_type : 'bot', inventory : [] })
      }
      manager.loadInventory(appId, contextId, true, function(err, inventory){
        if(err){
          console.log(err)
          return reject(err)
        }
        const filteredInventory = compareInventories(itemsToGiveArray, inventory)
        if(!filteredInventory) {
          return reject(new Error("Bot Inventory not matching"))
        }
        console.log('Bot Inventory matches the payload')
        return resolve({inventory_type : 'bot', inventory : filteredInventory })

      })
    })
  }

  /**
  * Match and return the items present in the inventory
  * @method
  * @param  {array} itemsToGiveOrReceiveArray Array of Items Objects
  * @param  {array} inventory                 User/Bot inventory
  * @return {array}                           Array of filtered items
  */
  const filterInventory = (itemsToGiveOrReceiveArray, inventory) => {
    const filteredItems = _.filter(inventory, function(item){
      const itemObj = {
        id : item.id,
        classid : item.classid,
        instanceid : item.instanceid,
        assetid : item.assetid,
        amount : item.amount
      }
      return _.some(itemsToGiveOrReceiveArray, itemObj)
    })
    return filteredItems
  }

  const compareInventories = (itemsToGiveOrReceiveArray, inventory) => {
    const filteredInventory = filterInventory(itemsToGiveOrReceiveArray, inventory)
    if(filteredInventory.length != itemsToGiveOrReceiveArray.length) {
      return false
    }
    return filteredInventory
  }

  /**
  * Get the offer Escrow Duration
  * @method
  * @param  {string} steamID   User SteamID
  * @return {Promise}         Resolve with userEscrow duraction and bot duration
  */
  module.getEscrowDays = (steamID, token = '') => {
    return new Promise((resolve, reject) => {
      manager.getEscrowDuration(steamID, token, function(err, daysTheirEscrow, daysBotEscrow){
        if(err){
          console.log(err)
          return reject(err)
        }
        console.log('days their escrow', daysTheirEscrow)
        console.log('days Our escrow', daysBotEscrow)
        return resolve({ 'user_duration' : daysTheirEscrow, 'bot_duration' : daysBotEscrow})

      })
    })
  }

  /**
  * Check the Escrow Duraction against our accepted values
  * @method
  * @param  {object} userAndBotEscrowDuration Object with the user/bot escrow duration
  * @return {Promise}
  */
  module.checkEscrowAcceptance = (userAndBotEscrowDuration) => {
    return new Promise((resolve, reject) => {
      const numDaysAccepted = 0
      const userDuration = userAndBotEscrowDuration.user_duration
      const botDuration = userAndBotEscrowDuration.bot_duration
      if(userDuration > numDaysAccepted) {
        return reject(new Error("User Escrow Limitation"))
      } else if (botDuration > numDaysAccepted) {
        return reject(new Error("Bot Escrow Limitation"))
      }
      return resolve()
    });

  }

  return module;
}
