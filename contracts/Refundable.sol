pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";


contract Refundable {
    using SafeERC20 for ERC20;

    string private constant ERROR_NOT_GOVERNOR = "REF_NOT_GOVERNOR";
    string private constant ERROR_ZERO_AMOUNT = "REF_ZERO_AMOUNT";
    string private constant ERROR_NOT_ENOUGH_BALANCE = "REF_NOT_ENOUGH_BALANCE";
    string private constant ERROR_ETH_REFUND = "REF_ETH_REFUND";
    string private constant ERROR_TOKEN_REFUND = "REF_TOKEN_REFUND";

    address public governor;

    modifier onlyGovernor() {
        require(msg.sender == governor, ERROR_NOT_GOVERNOR);
        _;
    }

    constructor(address _governor) public {
        governor = _governor;
    }

    /**
    * @notice Refunds accidentally sent ETH. Only governor can do it
    * @param _recipient Address to send funds to
    * @param _amount Amount to be refunded
    */
    function refundEth(address payable _recipient, uint256 _amount) external onlyGovernor {
        require(_amount > 0, ERROR_ZERO_AMOUNT);
        uint256 selfBalance = address(this).balance;
        require(selfBalance >= _amount, ERROR_NOT_ENOUGH_BALANCE);

        // solium-disable security/no-call-value
        (bool result,) = _recipient.call.value(_amount)("");
        require(result, ERROR_ETH_REFUND);
    }

    /**
    * @notice Refunds accidentally sent ERC20 tokens. Only governor can do it
    * @param _token Token to be refunded
    * @param _recipient Address to send funds to
    * @param _amount Amount to be refunded
    */
    function refundToken(ERC20 _token, address _recipient, uint256 _amount) external onlyGovernor {
        require(_amount > 0, ERROR_ZERO_AMOUNT);
        uint256 selfBalance = _token.balanceOf(address(this));
        require(selfBalance >= _amount, ERROR_NOT_ENOUGH_BALANCE);

        require(_token.safeTransfer(_recipient, _amount), ERROR_TOKEN_REFUND);
    }
}
