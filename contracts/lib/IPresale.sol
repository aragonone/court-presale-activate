pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/ERC20.sol";


interface IPresale {
    function open() external;
    function close() external;
    function contribute(address _contributor, uint256 _value) external payable;
    function refund(address _contributor, uint256 _vestedPurchaseId) external;
    function contributionToTokens(uint256 _value) external view returns (uint256);
    function contributionToken() external view returns (ERC20);
    function isClosed() external view returns (bool);
}
