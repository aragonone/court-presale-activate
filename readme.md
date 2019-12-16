# Court Presale Activate <img align="right" src="https://raw.githubusercontent.com/aragon/design/master/readme-logo.png" height="80px" /> [![Travis branch](https://img.shields.io/travis/aragon/court-presale-activate/master.svg?style=for-the-badge)](https://travis-ci.com/aragon/aragon/court-presale-activate)

This repo provides a wrapper to allow jurors of Aragon Court converting ANT into ANJ and activating it in a single transaction.

### Receive approval

This contract only exposes the following function. It should be called by the contribution token of Aragon Court, in this case ANT.

```solidity
/**
* @dev This function must be triggered by the contribution token approve-and-call fallback.
*      It will pull the approved tokens and covert them into the presale instance, and activate the converted tokens into a
*      jurors registry instance of an Aragon Court.
* @param _from Address of the original caller (juror) converting and activating the tokens 
* @param _amount Amount of contribution tokens to be converted and activated
* @param _token Address of the contribution token triggering the approve-and-call fallback
* @param Extra-data not used in this function, declared only for compatibility reasons 
*/

function receiveApproval(address _from, uint256 _amount, address _token, bytes calldata) external;
```
